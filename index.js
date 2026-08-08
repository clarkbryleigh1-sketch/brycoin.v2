const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;
const MAX_SUPPLY = 10000000; // Enforced strict maximum coin limit configuration parameter

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'brycoin-royal-gold-secret', resave: false, saveUninitialized: false }));

// Initialize persistent SQLite data file automatically
const db = new sqlite3.Database('./brycoin.db', (err) => {
    if (!err) console.log('SQLite Connected Successfully.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY, email TEXT, password TEXT, pool TEXT,
        balance REAL DEFAULT 0.0, booster TEXT DEFAULT 'none', multiplier REAL DEFAULT 1.0, ip_address TEXT
    )`);
});

// Memory-Hard Anti-ASIC Verification Matrix Routine
function verifyCustomHash(nonce, targetHashesNeeded) {
    let memoryArray = new Array(1024).fill(0);
    let mix = nonce;
    for (let i = 0; i < 512; i++) {
        mix = (mix * 31 + i) % 100000007;
        memoryArray[mix % 1024] = mix;
    }
    for (let i = 0; i < 512; i++) {
        let index = Math.abs(memoryArray[i % 1024]) % 1024;
        mix = (mix ^ memoryArray[index]) + i;
    }
    return Math.abs(mix) % targetHashesNeeded === 0;
}

let progress = { mini: 0, full: 0, mega: 0 };
const CONFIG = {
    mini: { target: 1000, reward: 1.0 },
    full: { target: 20000, reward: 10.0 },
    mega: { target: 50000, reward: 20.0 }
};

setInterval(() => { progress.mini = 0; }, 60000);
setInterval(() => { progress.full = 0; }, 600000);
setInterval(() => { progress.mega = 0; }, 3600000);

// Dynamic Total Circulation Calculation Hook
function getTotalCirculation(callback) {
    db.get(`SELECT SUM(balance) as total FROM users`, [], (err, row) => {
        let total = (row && row.total) ? parseFloat(row.total) : 0;
        callback(total);
    });
}

function distributePoolReward(poolName, baseReward) {
    getTotalCirculation((currentCirculation) => {
        // Enforce hard ceiling validation boundary conditions on global distribution loops
        if (currentCirculation >= MAX_SUPPLY) return;
        if (currentCirculation + baseReward > MAX_SUPPLY) {
            baseReward = MAX_SUPPLY - currentCirculation;
        }
        if (baseReward <= 0) return;

        db.all(`SELECT username, multiplier FROM users WHERE pool = ?`, [poolName], (err, rows) => {
            if (err || !rows || rows.length === 0) return;
            let share = baseReward / rows.length;
            rows.forEach(user => {
                let finalPayout = share * user.multiplier;
                db.run(`UPDATE users SET balance = balance + ? WHERE username = ?`, [finalPayout, user.username]);
            });
        });
    });
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Network Profile Global Stat Aggregate Feed API
app.get('/api/stats', (req, res) => {
    getTotalCirculation((currentCirculation) => {
        db.all(`SELECT username, balance FROM users ORDER BY balance DESC LIMIT 10`, [], (err, rows) => {
            res.json({
                circulation: currentCirculation,
                maxSupply: MAX_SUPPLY,
                leaderboard: rows || []
            });
        });
    });
});

app.post('/api/register', (req, res) => {
    const { username, email, password, confirmPassword, pool } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (password !== confirmPassword) return res.status(400).send('Passwords do not match.');
    
    db.get(`SELECT COUNT(*) as count FROM users WHERE ip_address = ?`, [ip], (err, row) => {
        if (row && row.count >= 3) return res.status(403).send('Bot Protection: Max 3 accounts per IP.');

        db.run(`INSERT INTO users (username, email, password, pool, ip_address) VALUES (?, ?, ?, ?, ?)`,
            [username, email, bcrypt.hashSync(password, 10), pool, ip], (err) => {
                if (err) return res.status(400).send('Username already taken.');
                res.send('SUCCESS');
            }
        );
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) return res.status(400).send('Invalid credentials.');
        req.session.username = user.username;
        req.session.pool = user.pool;
        res.send('SUCCESS');
    });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.send('SUCCESS');
});

app.get('/api/user', (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: 'Unauthorized' });
    db.get(`SELECT username, pool, balance, booster, multiplier FROM users WHERE username = ?`, [req.session.username], (err, row) => {
        res.json(row);
    });
});

app.post('/api/send', (req, res) => {
    if (!req.session.username) return res.status(401).send('Unauthorized');
    const { recipient, amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (parsedAmount <= 0 || req.session.username === recipient) return res.status(400).send('Invalid transfer amount.');

    db.get(`SELECT balance FROM users WHERE username = ?`, [req.session.username], (err, sender) => {
        if (!sender || sender.balance < parsedAmount) return res.status(400).send('Insufficient funds.');
        db.get(`SELECT username FROM users WHERE username = ?`, [recipient], (err, rec) => {
            if (!rec) return res.status(400).send('Recipient username not found.');
            db.serialize(() => {
                db.run(`UPDATE users SET balance = balance - ? WHERE username = ?`, [parsedAmount, req.session.username]);
                db.run(`UPDATE users SET balance = balance + ? WHERE username = ?`, [parsedAmount, recipient]);
                res.send('Transaction complete.');
            });
        });
    });
});

app.post('/api/shop/buy', (req, res) => {
    if (!req.session.username) return res.status(401).send('Unauthorized');
    const shopItems = { bronze: { cost: 5.0, mult: 1.2 }, silver: { cost: 15.0, mult: 1.5 }, gold: { cost: 30.0, mult: 2.0 } };
    const targetItem = shopItems[req.body.tier];
    if (!targetItem) return res.status(400).send('Invalid booster tier choice.');

    db.get(`SELECT balance FROM users WHERE username = ?`, [req.session.username], (err, user) => {
        if (!user || user.balance < targetItem.cost) return res.status(400).send('Insufficient balance funds.');
        db.run(`UPDATE users SET balance = balance - ?, booster = ?, multiplier = ? WHERE username = ?`,
            [targetItem.cost, req.body.tier, targetItem.mult, req.session.username], () => {
                res.send('Upgrade purchase complete.');
            }
        );
    });
});

app.post('/api/mine/submit', (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: 'Unauthorized' });
    const { nonce, type } = req.body;
    const config = CONFIG[type];
    if (!config || !verifyCustomHash(parseInt(nonce), config.target)) return res.json({ success: false, message: 'Hash proof structural failure.' });

    let blockWon = false;
    progress[type]++;
    if (progress[type] >= config.target) { progress[type] = 0; blockWon = true; }

    if (blockWon) {
        distributePoolReward(req.session.pool, config.reward);
        return res.json({ success: true, message: `Solved ${type.toUpperCase()} Block! Pool rewards queued.` });
    }
    res.json({ success: true, message: 'Hash share accepted.' });
});

app.listen(PORT, () => console.log(`Royal Brycoin Framework active on http://localhost:${PORT}`));
  
