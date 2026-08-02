const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SQLite Database
const db = new sqlite3.Database('./lottery.db', (err) => {
  if (err) console.error("Database Connection Error:", err);
  else console.log("Connected to SQLite Database.");
});

// Database Tables Tidy Up
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period INTEGER,
      number INTEGER,
      bigSmall TEXT,
      color TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      password TEXT,
      balance REAL DEFAULT 10000
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      type TEXT,
      amount REAL,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

let currentPeriod = 202608020001;
let timeLeft = 60;
let forcedResultNumber = null;

db.get("SELECT period FROM history ORDER BY id DESC LIMIT 1", (err, row) => {
  if (!err && row && row.period) currentPeriod = row.period + 1;
});

setInterval(() => {
  timeLeft--;
  io.emit('timer_tick', { period: currentPeriod, timeLeft: timeLeft });

  if (timeLeft <= 0) {
    let winningNum = (forcedResultNumber !== null && forcedResultNumber >= 0 && forcedResultNumber <= 9) ? forcedResultNumber : Math.floor(Math.random() * 10);
    forcedResultNumber = null;

    const bsText = winningNum >= 5 ? "အကြီး" : "အသေး";
    let colorText = winningNum === 0 ? "အနီ/ခရမ်း" : winningNum === 5 ? "အစိမ်း/ခရမ်း" : (winningNum % 2 === 0 ? "အနီရောင်" : "အစိမ်းရောင်");

    const result = { period: currentPeriod, number: winningNum, bigSmall: bsText, color: colorText };

    const stmt = db.prepare("INSERT INTO history (period, number, bigSmall, color) VALUES (?, ?, ?, ?)");
    stmt.run(result.period, result.number, result.bigSmall, result.color);
    stmt.finalize();

    io.emit('new_game_result', result);
    currentPeriod++;
    timeLeft = 60;
  }
}, 1000);

// --- Auth APIs ---
app.post('/api/register', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ success: false, message: 'ဖုန်းနံပါတ်နှင့် စကားဝှက် ရိုက်ထည့်ပါ' });

  const stmt = db.prepare("INSERT INTO users (phone, password, balance) VALUES (?, ?, 10000)");
  stmt.run(phone, password, function(err) {
    if (err) return res.status(400).json({ success: false, message: 'ဒီဖုန်းနံပါတ်ဖြင့် အကောင့်ဖွင့်ပြီးသားဖြစ်သည်' });
    res.json({ success: true, user: { phone: phone, balance: 10000 } });
  });
  stmt.finalize();
});

app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  db.get("SELECT phone, balance FROM users WHERE phone = ? AND password = ?", [phone, password], (err, row) => {
    if (err || !row) return res.status(401).json({ success: false, message: 'ဖုန်းနံပါတ် သို့မဟုတ် စကားဝှက် မှားယွင်းနေသည်' });
    res.json({ success: true, user: row });
  });
});

app.get('/api/user/:phone', (req, res) => {
  db.get("SELECT phone, balance FROM users WHERE phone = ?", [req.params.phone], (err, row) => {
    if (err || !row) return res.status(404).json({ success: false });
    res.json({ success: true, user: row });
  });
});

// --- Transactions APIs ---
app.post('/api/transaction/request', (req, res) => {
  const { phone, type, amount } = req.body;
  db.run("INSERT INTO transactions (phone, type, amount) VALUES (?, ?, ?)", [phone, type, amount], (err) => {
    if (err) return res.status(500).json({ success: false, message: 'တောင်းဆိုမှု မအောင်မြင်ပါ' });
    res.json({ success: true, message: 'တောင်းဆိုမှု အောင်မြင်ပါသည်။ Admin အတည်ပြုပေးသည်အထိ စောင့်ပါ' });
  });
});

app.get('/api/transaction/history/:phone', (req, res) => {
  db.all("SELECT type, amount, status, created_at FROM transactions WHERE phone = ? ORDER BY id DESC LIMIT 10", [req.params.phone], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

// --- Admin APIs ---
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/admin/pending-tx', (req, res) => {
  db.all("SELECT * FROM transactions WHERE status = 'PENDING' ORDER BY id DESC", [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/admin/process-tx', (req, res) => {
  const { id, action, phone, type, amount } = req.body;
  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  db.run("UPDATE transactions SET status = ? WHERE id = ?", [newStatus, id], function(err) {
    if (err) return res.status(500).json({ success: false });

    if (action === 'APPROVE') {
      if (type === 'Deposit') {
        db.run("UPDATE users SET balance = balance + ? WHERE phone = ?", [amount, phone]);
      } else if (type === 'Withdraw') {
        db.run("UPDATE users SET balance = balance - ? WHERE phone = ?", [amount, phone]);
      }
    }
    res.json({ success: true });
  });
});

app.get('/api/history', (req, res) => {
  db.all("SELECT period, number, bigSmall, color FROM history ORDER BY id DESC LIMIT 20", [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/bet', (req, res) => res.json({ success: true }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

