const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;
const MAX_SUPPLY = 10000000; // 10 Million Max Supply

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'brycoin-secure-node-secret',
    resave: false,
    saveUninitialized: false
}));

// Initialize SQLite3 Database
const db = new sqlite3.Database('./brycoin.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to SQLite3 database.');
});

// Create Database Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        email TEXT,
        password TEXT,
        pool TEXT,
        balance REAL DEFAULT 0.0,
        booster TEXT DEFAULT 'none',
        multiplier REAL DEFAULT 1.0,
        ip_address TEXT
    )`);
});

// Helper: Custom Memory-Hard Anti-ASIC Verification Algorithm
function verifyCustomHash(nonce, targetHashesNeeded) {
    let memoryArray = new Array(1024).fill(0);
    let mix = nonce;
    
    // Memory-hard state scrambling to neutralize raw pipeline ASICs
    for (let i = 0; i < 512; i++) {
        mix = (mix * 31 + i) % 100000007;
        memoryArray[mix % 1024] = mix;
    }
    
    for (let i = 0; i < 512; i++) {
        let index = Math.abs(memoryArray[i % 1024]) % 1024;
        mix = (mix ^ memoryArray[index]) + i;
    }
    
    // Returns a pseudo-random integer index mapping back to target sizes
    return Math.abs(mix) % targetHashesNeeded === 0;
}

// Global Blockchain State Tracking
let totalMintedCoins = 0;
let currentMiniProgress = 0;
let currentFullProgress = 0;
let currentMegaProgress = 0;

const BLOCK_CONFIGS = {
    mini: { target: 1000, reward: 1.0 },
    full: { target: 20000, reward: 10.0 },
    mega: { target: 50000, reward: 20.0 } // Mega scaling hash barrier
};

// Periodic Blockchain Reset Intervals
setInterval(() => { currentMiniProgress = 0; }, 60000);       // 1 Minute Mini
setInterval(() => { currentFullProgress = 0; }, 600000);      // 10 Minutes Full
setInterval(() => { currentMegaProgress = 0; }, 3600000);     // 1 Hour Mega

// Reward Equal Distribution Mechanics across Selected Pool Members
function distributePoolReward(poolName, baseReward) {
    if (totalMintedCoins >= MAX_SUPPLY) return;

    db.all(`SELECT username, multiplier FROM users WHERE pool = ?`, [poolName], (err, rows) => {
        if (err || !rows || rows.length === 0) return;
        
        let share = baseReward / rows.length;
        rows.forEach(user => {
            let finalPayout = share * user.multiplier;
            db.run(`UPDATE users SET balance = balance + ? WHERE username = ?`, [finalPayout, user.username]);
            totalMintedCoins += finalPayout;
        });
    });
}

// Helper tracking for IP constraint checks
function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

// --- Dynamic Web Asset Routing ---
app.get('/', (req, res) => {
    if (!req.session.username) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'register.html')));
app.get('/mining', (req, res) => {
    if (!req.session.username) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'templates', 'mining.html'));
});

// --- User Profile Account APIs ---
app.post('/api/register', (req, res) => {
    const { username, email, password, confirmPassword, pool } = req.body;
    const ip = getClientIp(req);

    if (password !== confirmPassword) return res.status(400).send('Passwords do not match.');
    
    // Bot Protection Limit Validation Check
    db.get(`SELECT COUNT(*) as count FROM users WHERE ip_address = ?`, [ip], (err, row) => {
        if (row && row.count >= 3) {
            return res.status(403).send('Bot Protection: Maximum of 3 accounts allowed per IP.');
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        db.run(`INSERT INTO users (username, email, password, pool, ip_address) VALUES (?, ?, ?, ?, ?)`,
            [username, email, hashedPassword, pool, ip], (err) => {
                if (err) return res.status(400).send('Username already registered.');
                res.redirect('/login');
            }
        );
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(400).send('Invalid credentials.');
        }
        req.session.username = user.username;
        req.session.pool = user.pool;
        res.redirect('/');
    });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/api/user', (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: 'Unauthorized' });
    db.get(`SELECT username, pool, balance, booster, multiplier FROM users WHERE username = ?`, [req.session.username], (err, row) => {
        res.json(row);
    });
});

// --- Dynamic Balance Transfers Using Direct Username Public Addresses ---
app.post('/api/send', (req, res) => {
    if (!req.session.username) return res.status(401).send('Unauthorized');
    const { recipient, amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (parsedAmount <= 0) return res.status(400).send('Invalid transaction value.');
    if (req.session.username === recipient) return res.status(400).send('Cannot transfer coins to yourself.');

    db.get(`SELECT balance FROM users WHERE username = ?`, [req.session.username], (err, sender) => {
        if (!sender || sender.balance < parsedAmount) return res.status(400).send('Insufficient balance funds.');

        db.get(`SELECT username FROM users WHERE username = ?`, [recipient], (err, rec) => {
            if (!rec) return res.status(400).send('Recipient wallet username not found.');

            db.serialize(() => {
                db.run(`UPDATE users SET balance = balance - ? WHERE username = ?`, [parsedAmount, req.session.username]);
                db.run(`UPDATE users SET balance = balance + ? WHERE username = ?`, [parsedAmount, recipient]);
                res.send('Transaction completed successfully.');
            });
        });
    });
});

// --- Functional In-Game Upgrade Multiplier Booster Shop API ---
app.post('/api/shop/buy', (req, res) => {
    if (!req.session.username) return res.status(401).send('Unauthorized');
    const { tier } = req.body;

    const shopItems = {
        bronze: { cost: 5.0, mult: 1.2 },
        silver: { cost: 15.0, mult: 1.5 },
        gold: { cost: 30.0, mult: 2.0 }
    };

    const targetItem = shopItems[tier];
    if (!targetItem) return res.status(400).send('Invalid shop configuration target item.');

    db.get(`SELECT balance FROM users WHERE username = ?`, [req.session.username], (err, user) => {
        if (!user || user.balance < targetItem.cost) return res.status(400).send('Insufficient balance funds for purchase.');

        db.run(`UPDATE users SET balance = balance - ?, booster = ?, multiplier = ? WHERE username = ?`,
            [targetItem.cost, tier, targetItem.mult, req.session.username], (err) => {
                res.send(`Successfully purchased ${tier} booster! Reward multipliers updated to ${targetItem.mult}x.`);
            }
        );
    });
});

// --- Phone Mining Strict Hash Verification API Pipeline ---
app.post('/api/mine/submit', (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: 'Unauthorized' });
    const { nonce, type } = req.body;
    const config = BLOCK_CONFIGS[type];

    if (!config) return res.status(400).json({ error: 'Invalid block challenge submission configuration.' });

    // Enforce back-end algorithmic security check validation on every hash
    const isValid = verifyCustomHash(parseInt(nonce), config.target);
    if (!isValid) return res.json({ success: false, message: 'Invalid verification proof configuration.' });

    let blockWon = false;
    if (type === 'mini') {
        currentMiniProgress++;
        if (currentMiniProgress >= config.target) { currentMiniProgress = 0; blockWon = true; }
    } else if (type === 'full') {
        currentFullProgress++;
        if (currentFullProgress >= config.target) { currentFullProgress = 0; blockWon = true; }
    } else if (type === 'mega') {
        currentMegaProgress++;
        if (currentMegaProgress >= config.target) { currentMegaProgress = 0; blockWon = true; }
    }

    if (blockWon) {
        distributePoolReward(req.session.pool, config.reward);
        return res.json({ success: true, message: `Block Target Solved! Rewards split across ${req.session.pool}.` });
    }

    res.json({ success: true, message: 'Hash validation check accepted.' });
});

app.listen(PORT, () => console.log(`Server executing at http://localhost:${PORT}`));
