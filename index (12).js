const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const DB_PATH = path.join(__dirname, 'brycoin_v5.db');
const db = new sqlite3.Database(DB_PATH);

const activeNetworkMinersMap = new Map();

db.serialize(() => {
  db.run("PRAGMA synchronous = OFF;");
  db.run("PRAGMA journal_mode = MEMORY;");
  
  db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    billing_address TEXT NOT NULL,
    postcode TEXT NOT NULL,
    balance REAL DEFAULT 0.0,
    last_faucet TEXT DEFAULT NULL,
    hash_multiplier REAL DEFAULT 1.0,
    is_admin INTEGER DEFAULT 0
  )`);

  db.run(`INSERT OR IGNORE INTO users (username, password, email, first_name, billing_address, postcode, balance, is_admin)
    VALUES ('admin', 'admin123', 'compliance@brycoin.gold', 'Lead Admin', '100 Bullion Reserve Way', '2000', 5000.0, 1)`);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'brycoin-gold-monolithic-lattice-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.username) return res.status(401).json({ error: 'Session expired or unauthorized.' });
  next();
}

const MAX_SUPPLY = 21000000.0;
let baseCirculation = 1500000.00;

app.post('/api/auth/register', (req, res) => {
  const { username, password, email, first_name, billing_address, postcode } = req.body;
  if (!username || !password || !email || !first_name || !billing_address || !postcode) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  db.run(
    `INSERT INTO users (username, password, email, first_name, billing_address, postcode, balance, hash_multiplier, is_admin) 
     VALUES (?, ?, ?, ?, ?, ?, 0.0, 1.0, 0)`,
    [username.trim().toLowerCase(), password, email, first_name, billing_address, postcode],
    function(err) {
      if (err) return res.status(400).json({ error: 'Wallet Address already allocated.' });
      req.session.username = username.trim().toLowerCase();
      req.session.isAdmin = false;
      res.json({ success: true, username: req.session.username });
    }
  );
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT username, is_admin FROM users WHERE username = ? AND password = ?`, [username.trim().toLowerCase(), password], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Invalid identification credentials.' });
    req.session.username = user.username;
    req.session.isAdmin = !!user.is_admin;
    res.json({ success: true, username: user.username, isAdmin: !!user.is_admin });
  });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session.username) activeNetworkMinersMap.delete(req.session.username);
  req.session.destroy(() => res.json({ success: true }));
});

app.post('/api/miner/heartbeat', requireAuth, (req, res) => {
  const username = req.session.username;
  const currentSpeed = parseFloat(req.body.hashrate) || 0.0;
  
  if (currentSpeed > 0) {
    activeNetworkMinersMap.set(username, { speed: currentSpeed, timestamp: Date.now() });
  } else {
    activeNetworkMinersMap.delete(username);
  }
  res.json({ success: true });
});

app.get('/api/network/stats', (req, res) => {
  const staleCutoff = Date.now() - 8000;
  let runningGlobalHashrate = 0.0;
  
  for (const [user, data] of activeNetworkMinersMap.entries()) {
    if (data.timestamp < staleCutoff) {
      activeNetworkMinersMap.delete(user);
    } else {
      runningGlobalHashrate += data.speed;
    }
  }

  db.all(`SELECT username, balance FROM users ORDER BY balance DESC LIMIT 3`, [], (err, topBalances) => {
    if (err) topBalances = [];
    while (topBalances.length < 3) {
      topBalances.push({ username: 'Void Placement', balance: 0.0 });
    }
    db.get(`SELECT SUM(balance) as active_balances FROM users`, [], (err, row) => {
      const liveCirculation = Math.min(MAX_SUPPLY, baseCirculation + (row?.active_balances || 0));
      res.json({
        circulation: parseFloat(liveCirculation.toFixed(4)),
        maxSupply: MAX_SUPPLY,
        topBalances: topBalances,
        globalHashrate: parseFloat(runningGlobalHashrate.toFixed(2))
      });
    });
  });
});

app.get('/api/user/profile', requireAuth, (req, res) => {
  db.get(`SELECT username, balance, hash_multiplier, is_admin FROM users WHERE username = ?`, [req.session.username], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Profile not found.' });
    res.json(user);
  });
});

app.post('/api/user/faucet', requireAuth, (req, res) => {
  const username = req.session.username;
  db.get(`SELECT last_faucet, balance FROM users WHERE username = ?`, [username], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User missing.' });

    const now = new Date();
    if (user.last_faucet) {
      const lastClaim = new Date(user.last_faucet);
      if (now.getTime() - lastClaim.getTime() < 24 * 60 * 60 * 1000) {
        const remaining = (24 * 60 * 60 * 1000) - (now.getTime() - lastClaim.getTime());
        return res.status(400).json({ error: `Faucet locked. Try again in ${Math.ceil(remaining / (1000 * 60 * 60))} hours.` });
      }
    }

    const updatedBalance = user.balance + 5.0;
    db.run(`UPDATE users SET balance = ?, last_faucet = ? WHERE username = ?`, [updatedBalance, now.toISOString(), username], (err) => {
      if (err) return res.status(500).json({ error: 'Database update failed.' });
      res.json({ success: true, balance: updatedBalance, message: 'Successfully claimed 5.00 BRY faucet reward!' });
    });
  });
});

app.post('/api/user/mine-reward', requireAuth, (req, res) => {
  const username = req.session.username;
  const targetReward = parseFloat(req.body.reward) || 0.25;

  db.get(`SELECT balance FROM users WHERE username = ?`, [username], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User record missing.' });
    db.run(`UPDATE users SET balance = ? WHERE username = ?`, [user.balance + targetReward, username], () => {
      res.json({ success: true, balance: user.balance + targetReward });
    });
  });
});

app.post('/api/user/buy-booster', requireAuth, (req, res) => {
  const username = req.session.username;
  const cost = parseFloat(req.body.cost);
  const powerBonus = parseFloat(req.body.power);

  db.get(`SELECT balance, hash_multiplier FROM users WHERE username = ?`, [username], (err, user) => {
    if (err || !user || user.balance < cost) return res.status(400).json({ error: 'Invalid operation or insufficient balance.' });
    db.run(`UPDATE users SET balance = ?, hash_multiplier = ? WHERE username = ?`, [user.balance - cost, user.hash_multiplier + powerBonus, username], () => {
      res.json({ success: true, balance: user.balance - cost, multiplier: user.hash_multiplier + powerBonus });
    });
  });
});

app.post('/api/user/transfer', requireAuth, (req, res) => {
  const sender = req.session.username;
  const targetRecipient = (req.body.recipient || '').trim().toLowerCase();
  const txAmount = parseFloat(req.body.amount);

  if (!targetRecipient || isNaN(txAmount) || txAmount <= 0 || sender === targetRecipient) {
    return res.status(400).json({ error: 'Invalid routing parameters.' });
  }

  db.get(`SELECT balance FROM users WHERE username = ?`, [sender], (err, sUser) => {
    if (err || !sUser || sUser.balance < txAmount) return res.status(400).json({ error: 'Insufficient balance.' });
    db.get(`SELECT username FROM users WHERE username = ?`, [targetRecipient], (err, rUser) => {
      if (err || !rUser) return res.status(444).json({ error: 'Destination profile address not registered.' });
      db.serialize(() => {
        db.run(`UPDATE users SET balance = balance - ? WHERE username = ?`, [txAmount, sender]);
        db.run(`UPDATE users SET balance = balance + ? WHERE username = ?`, [txAmount, targetRecipient]);
        res.json({ success: true, message: `Dispatched ${txAmount.toFixed(2)} BRY safely to ${targetRecipient}.` });
      });
    });
  });
});

app.get('/api/admin/explorer', requireAuth, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Unauthorized.' });
  db.all(`SELECT username, email, first_name, billing_address, postcode, balance, is_admin FROM users`, [], (err, rows) => {
    res.json(rows);
  });
});

app.post('/api/admin/moderate', requireAuth, (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Unauthorized.' });
  const { targetUser, command } = req.body;
  if (command === 'purge') {
    db.run(`DELETE FROM users WHERE username = ? AND is_admin = 0`, [targetUser], () => res.json({ success: true, message: 'User profile purged.' }));
  } else if (command === 'freeze') {
    db.run(`UPDATE users SET balance = 0.0 WHERE username = ? AND is_admin = 0`, [targetUser], () => res.json({ success: true, message: 'Assets locked to zero.' }));
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(3000);
