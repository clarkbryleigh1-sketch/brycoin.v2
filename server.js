const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 20170;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Disk-Persistent SQLite3 Database
const db = new sqlite3.Database('blockchain.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to the persistent blockchain.db file.');
});

// Setup Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        address TEXT,
        state TEXT,
        country TEXT,
        zip_code TEXT,
        wallet_address TEXT,
        balance REAL DEFAULT 0.0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY AUTOINCREMENT,
        prev_hash TEXT,
        curr_hash TEXT,
        nonce INTEGER,
        miner TEXT,
        pool TEXT,
        reward REAL,
        timestamp INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS txs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT,
        receiver TEXT,
        amount REAL,
        timestamp INTEGER
    )`);

    // Ensure system account exists. Note: Use environment variables for sensitive defaults.
    const systemAdminPass = process.env.ADMIN_PASSWORD || 'change_this_to_a_secure_password';
    db.get("SELECT username FROM users WHERE username = 'system_admin'", (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, first_name, last_name, email, wallet_address, balance) 
                    VALUES ('system_admin', ?, 'System', 'Administrator', 'admin@local.host', 'SYS_ADMIN_WALLET_XYZ', 0.0)`, [systemAdminPass]);
        }
    });
});

// Simulation Parameters
const SUPPLY_LIMIT = 30000000;
let networkDifficulty = 4;

function getBlockReward(callback) {
    db.get("SELECT SUM(reward) as total FROM blocks", (err, row) => {
        const currentMinted = (row && row.total) ? row.total : 0;
        if (currentMinted >= SUPPLY_LIMIT) {
            callback(0, currentMinted);
            return;
        }
        let baseReward = ((SUPPLY_LIMIT - currentMinted) / SUPPLY_LIMIT) * 50;
        if (baseReward < 0.1) baseReward = 0.1;
        callback(baseReward, currentMinted);
    });
}

const poolWorkers = { 'A': {}, 'B': {}, 'C': {} };

setInterval(() => {
    const now = Date.now();
    ['A', 'B', 'C'].forEach(pool => {
        for (const username in poolWorkers[pool]) {
            if (now - poolWorkers[pool][username].lastSeen > 10000) {
                delete poolWorkers[pool][username];
            }
        }
    });
}, 10000);

app.get('/api/stats', (req, res) => {
    getBlockReward((reward, currentMinted) => {
        db.get("SELECT COUNT(*) as count, curr_hash FROM blocks ORDER BY height DESC LIMIT 1", (err, row) => {
            const height = (row && row.count) ? row.count : 0;
            const lastHash = (row && row.curr_hash) ? row.curr_hash : "0".repeat(64);
            
            let totalNetworkHashrate = 0;
            const poolHashrates = { 'A': 0, 'B': 0, 'C': 0 };
            
            ['A', 'B', 'C'].forEach(p => {
                for (const u in poolWorkers[p]) {
                    poolHashrates[p] += poolWorkers[p][u].hashrate;
                    totalNetworkHashrate += poolWorkers[p][u].hashrate;
                }
            });

            res.json({
                supplyLimit: SUPPLY_LIMIT,
                currentMinted: parseFloat(currentMinted.toFixed(4)),
                blockReward: parseFloat(reward.toFixed(4)),
                height: height,
                lastHash: lastHash,
                difficulty: networkDifficulty,
                networkHashrate: totalNetworkHashrate
            });
        });
    });
});

app.post('/api/register', (req, res) => {
    const { username, password, first_name, last_name, email } = req.body;
    if (!username || !password) return res.status(400).send("Missing credentials.");
    const walletAddress = "WAL_" + Math.random().toString(36).substring(2, 15).toUpperCase();
    
    db.run(`INSERT INTO users (username, password, first_name, last_name, email, wallet_address) VALUES (?, ?, ?, ?, ?, ?)`,
        [username, password, first_name, last_name, email, walletAddress],
        (err) => {
            if (err) return res.status(400).send("Registration error.");
            res.redirect('/?registered=true');
        }
    );
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if (!row) return res.status(401).send("Invalid credentials.");
        res.json({ success: true, user: { username: row.username, wallet: row.wallet_address } });
    });
});

app.get('/api/user/:username', (req, res) => {
    db.get("SELECT username, wallet_address, balance FROM users WHERE username = ?", [req.params.username], (err, row) => {
        if (!row) return res.status(404).json({ error: "User not found" });
        res.json(row);
    });
});

app.post('/api/transact', (req, res) => {
    const { sender, receiver, amount } = req.body;
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0 || sender === receiver) return res.status(400).json({ error: "Invalid transaction." });

    db.get("SELECT balance FROM users WHERE username = ?", [sender], (err, sUser) => {
        if (!sUser || sUser.balance < value) return res.status(400).json({ error: "Insufficient funds." });
        
        db.get("SELECT username FROM users WHERE username = ?", [receiver], (err, rUser) => {
            if (!rUser) return res.status(400).json({ error: "Receiver not found." });

            db.serialize(() => {
                db.run("UPDATE users SET balance = balance - ? WHERE username = ?", [value, sender]);
                db.run("UPDATE users SET balance = balance + ? WHERE username = ?", [value, receiver]);
                db.run("INSERT INTO txs (sender, receiver, amount, timestamp) VALUES (?, ?, ?, ?)", [sender, receiver, value, Date.now()]);
            });
            res.json({ success: true });
        });
    });
});

function verifyCustomHash(dataString, nonce) {
    let input = dataString + nonce;
    let hashValue = 0;
    for (let i = 0; i < input.length; i++) {
        hashValue = ((hashValue << 5) - hashValue) + input.charCodeAt(i);
        hashValue |= 0;
    }
    let hexResult = "";
    for (let j = 0; j < 8; j++) {
        let seed = Math.sin(hashValue + j) * 10000;
        let hexPart = Math.floor((seed - Math.floor(seed)) * 4294967296).toString(16);
        hexResult += hexPart.padStart(8, '0');
    }
    return hexResult.substring(0, 64);
}

app.post('/api/miner/submit', (req, res) => {
    const { username, nonce, pool, prevHash } = req.body;
    db.get("SELECT curr_hash, height FROM blocks ORDER BY height DESC LIMIT 1", (err, lastBlock) => {
        const actualPrevHash = lastBlock ? lastBlock.curr_hash : "0".repeat(64);
        if (prevHash !== actualPrevHash) return res.json({ success: false, reason: "Chain moved." });

        const computed = verifyCustomHash(actualPrevHash + username, nonce);
        if (!computed.startsWith("0".repeat(networkDifficulty))) return res.json({ success: false, reason: "Invalid hash." });

        getBlockReward((reward, currentMinted) => {
            if (reward <= 0) return res.json({ success: false, reason: "Cap reached." });
            db.run("INSERT INTO blocks (prev_hash, curr_hash, nonce, miner, pool, reward, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [actualPrevHash, computed, parseInt(nonce), username, pool, reward, Date.now()],
                function(err) {
                    if (err) return res.json({ success: false });
                    db.run("UPDATE users SET balance = balance + ? WHERE username = ?", [reward, username]);
                    res.json({ success: true, reward });
                }
            );
        });
    });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head><title>Blockchain Simulator</title><style>body{background:#111;color:#eee;font-family:sans-serif;padding:20px} .card{background:#222;padding:15px;margin:10px 0;border:1px solid #444}</style></head>
<body>
    <h1>Blockchain Node Simulator</h1>
    <div class="card">
        <h3>Login</h3>
        <input id="u" placeholder="Username"> <input id="p" type="password" placeholder="Password">
        <button onclick="login()">Login</button>
    </div>
    <div id="dash" style="display:none">
        <div class="card">Balance: <span id="bal">0</span></div>
        <button id="mine" onclick="startMining()">Start Mining</button>
    </div>
    <script>
        async function login(){
            const res = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u.value,password:p.value})});
            if(res.ok){ dash.style.display='block'; update(); setInterval(update,5000); }
        }
        async function update(){
            const res = await fetch('/api/user/'+u.value);
            const data = await res.json();
            bal.innerText = data.balance;
        }
        function startMining(){ alert('Mining logic initialized in background...'); }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log(`Blockchain service running on http://localhost:${PORT}`));
  
