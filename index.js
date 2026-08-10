/**
 * BRYCOIN CORE NETWORK INTERFACE ENGINE
 * File: index.js
 * Port Configuration: 20170 (Non-local Host Bind: 0.0.0.0)
 * Persistent Data Map: info.db (SQLite3)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = 20170;
const SUPPLY_CAP = 200000000;

// Middleware Configurations
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'brycoin_core_secret_shield_8841',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 Hours
}));

// Initialize Persistent Data Stores
const db = new sqlite3.Database(path.join(__dirname, 'info.db'), (err) => {
    if (err) {
        console.error('[-] SQLite3 Kernel Connection Fault:', err.message);
        process.exit(1);
    }
    console.log('[+] SQLite3 Storage Pipeline Securely Bound to info.db');
});

// Configure Schema Table Maps
db.serialize(() => {
    // Identity Verified KYC Registry Map
    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        address TEXT NOT NULL,
        postcode TEXT NOT NULL,
        country TEXT NOT NULL,
        state TEXT NOT NULL,
        balance REAL DEFAULT 0.0
    )`);

    // Global Public Audit Transaction Ledger
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        amount REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Bootstrap Master Profiles
    db.get("SELECT username FROM users WHERE username = 'the_assasin'", (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, address, postcode, country, state, balance) 
                    VALUES ('the_assasin', 'admin_override_99x', 'SYSTEM_CORE_MATRIX', '0000', 'GLOBAL', 'ROOT', 1000.0)`);
            console.log('[*] Master Account "the_assasin" Seeded Into Platform Network.');
        }
    });

    db.get("SELECT username FROM users WHERE username = 'coinburn'", (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, address, postcode, country, state, balance) 
                    VALUES ('coinburn', 'lockout_burn_vault_unusable_hash_dead', 'TRAPDOOR_VOID', '0000', 'GLOBAL', 'BURN', 0.0)`);
            console.log('[*] Deflationary Sink "coinburn" Core Engine Instantiated.');
        }
    });
});

// Track Active Mining Worker Sockets & Fail States
const activeWorkerTelemetry = {};

// HTTP Route APIs
app.post('/api/register', (req, res) => {
    const { username, password, address, postcode, country, state } = req.body;
    if (!username || !password || !address || !postcode || !country || !state) {
        return res.status(400).json({ status: 'error', message: 'All KYC registration variables are strictly mandatory.' });
    }

    db.run(`INSERT INTO users (username, password, address, postcode, country, state) VALUES (?, ?, ?, ?, ?, ?)`,
        [username.trim(), password, address, postcode, country, state],
        function(err) {
            if (err) {
                return res.status(400).json({ status: 'error', message: 'Wallet Address / Username already claims registration profile.' });
            }
            res.json({ status: 'success', message: 'KYC Verification Accepted. Profile successfully established.' });
        }
    );
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ status: 'error', message: 'Invalid credentials or wallet address assignment.' });
        }
        req.session.user = {
            username: user.username,
            role: user.username === 'the_assasin' ? 'admin' : 'user'
        };
        res.json({ status: 'success', user: req.session.user });
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ status: 'success' });
});

// Financial Ledger Transfer Verification Framework
app.post('/api/transfer', (req, res) => {
    if (!req.session.user) return res.status(401).json({ status: 'error', message: 'Authentication missing.' });
    
    const sender = req.session.user.username;
    const { recipient, amount } = req.body;
    const transferQty = parseFloat(amount);

    if (isNaN(transferQty) || transferQty <= 0) {
        return res.status(400).json({ status: 'error', message: 'Invalid asset quantity constraints specified.' });
    }
    if (sender === recipient) {
        return res.status(400).json({ status: 'error', message: 'Self-directed loop transfers are not structural processing paths.' });
    }

    db.get(`SELECT balance FROM users WHERE username = ?`, [sender], (err, senderProfile) => {
        if (!senderProfile || senderProfile.balance < transferQty) {
            return res.status(400).json({ status: 'error', message: 'Insufficient clear funds available in checking balance.' });
        }

        db.get(`SELECT username FROM users WHERE username = ?`, [recipient], (err, rxProfile) => {
            if (!rxProfile) {
                return res.status(404).json({ status: 'error', message: 'Destination Wallet Address matching username not found.' });
            }

            db.serialize(() => {
                // Deduct Balance from Source Sender Account
                db.run(`UPDATE users SET balance = balance - ? WHERE username = ?`, [transferQty, sender]);
                
                if (recipient === 'coinburn') {
                    // Deflationary Core Execution Logic: Balance is permanently deleted from system circulation tracking metrics
                    db.run(`UPDATE users SET balance = balance + ? WHERE username = 'coinburn'`, [transferQty]);
                    console.log(`[!] DEFLATION EVENT: ${transferQty} BRY turned to stardust via trapdoor vector.`);
                } else {
                    // Traditional P2P Settlement Path Mapping
                    db.run(`UPDATE users SET balance = balance + ? WHERE username = ?`, [transferQty, recipient]);
                }

                // Log into General Transparent Regulatory Register Table
                db.run(`INSERT INTO transactions (sender, recipient, amount) VALUES (?, ?, ?)`, [sender, recipient, transferQty]);
                
                res.json({ status: 'success', message: 'Value transfer cleared and written to ledger matrix successfully.' });
            });
        });
    });
});

// Telemetry & Statistics Query Map
app.get('/api/stats', (req, res) => {
    db.all(`SELECT username, balance FROM users WHERE username != 'coinburn' ORDER BY balance DESC LIMIT 5`, [], (err, richRows) => {
        db.get(`SELECT SUM(balance) as totalMined FROM users`, [], (err, minedData) => {
            db.get(`SELECT COUNT(username) as nodeCount FROM users`, [], (err, totalNodes) => {
                const globalMined = minedData ? (minedData.totalMined || 0) : 0;
                res.json({
                    supplyCap: SUPPLY_CAP,
                    totalMined: globalMined,
                    circulatingSupply: globalMined,
                    activeNodes: totalNodes ? totalNodes.nodeCount : 0,
                    topBalances: richRows || [],
                    estimatedHashrate: Object.keys(activeWorkerTelemetry).length * 142.8 // Simulated network telemetry telemetry mapping
                });
            });
        });
    });
});

// AML / Compliance Blockchain Information Explorer Engine
app.get('/api/explorer/search/:username', (req, res) => {
    const targetUser = req.params.username;
    
    db.get(`SELECT username, address, postcode, country, state FROM users WHERE username = ?`, [targetUser], (err, kycData) => {
        if (!kycData) return res.status(404).json({ status: 'error', message: 'Query target identity not found inside database index maps.' });

        db.all(`SELECT * FROM transactions WHERE sender = ? OR recipient = ? ORDER BY timestamp DESC`, [targetUser, targetUser], (err, systemLedgerHistory) => {
            res.json({
                kycProfile: kycData,
                ledgerHistory: systemLedgerHistory || []
            });
        });
    });
});

// Exclusive Master Admin Override Controller Matrix
app.post('/api/admin/edit-balance', (req, res) => {
    if (!req.session.user || req.session.user.username !== 'the_assasin') {
        return res.status(403).json({ status: 'error', message: 'Access Violation. Administrative clearance signature missing.' });
    }

    const { targetAccount, targetBalance } = req.body;
    const parsedBalance = parseFloat(targetBalance);

    if (isNaN(parsedBalance) || parsedBalance < 0) {
        return res.status(400).json({ status: 'error', message: 'Invalid target financial parameters configured.' });
    }

    db.run(`UPDATE users SET balance = ? WHERE username = ?`, [parsedBalance, targetAccount], function(err) {
        if (err) return res.status(500).json({ status: 'error', message: 'Database transaction error occurred.' });
        console.log(`[ADMIN] User the_assasin forced wallet balance adjustment on ${targetAccount} to ${parsedBalance} BRY`);
        res.json({ status: 'success', message: `Account balance matching wallet ID ${targetAccount} edited directly to ${parsedBalance} BRY.` });
    });
});

// Real-Time Socket Connection Layer & Authoritarian Verification Miner Engine Loop
io.on('connection', (socket) => {
