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

// SQLite Database ချိတ်ဆက်ခြင်း
const db = new sqlite3.Database('./lottery.db', (err) => {
  if (err) console.error("Database Connection Error:", err);
  else console.log("Connected to SQLite Database.");
});

// History & Users Tables တည်ဆောက်ခြင်း
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
});

let currentPeriod = 202608020001;
let timeLeft = 60;
let forcedResultNumber = null;

db.get("SELECT period FROM history ORDER BY id DESC LIMIT 1", (err, row) => {
  if (!err && row && row.period) {
    currentPeriod = row.period + 1;
  }
});

setInterval(() => {
  timeLeft--;

  io.emit('timer_tick', {
    period: currentPeriod,
    timeLeft: timeLeft
  });

  if (timeLeft <= 0) {
    let winningNum;
    if (forcedResultNumber !== null && forcedResultNumber >= 0 && forcedResultNumber <= 9) {
      winningNum = forcedResultNumber;
      forcedResultNumber = null;
    } else {
      winningNum = Math.floor(Math.random() * 10);
    }

    const isBig = winningNum >= 5;
    const bsText = isBig ? "အကြီး" : "အသေး";

    let colorText = "";
    if (winningNum === 0) colorText = "အနီ/ခရမ်း";
    else if (winningNum === 5) colorText = "အစိမ်း/ခရမ်း";
    else if (winningNum % 2 === 0) colorText = "အနီရောင်";
    else colorText = "အစိမ်းရောင်";

    const result = {
      period: currentPeriod,
      number: winningNum,
      bigSmall: bsText,
      color: colorText
    };

    const stmt = db.prepare("INSERT INTO history (period, number, bigSmall, color) VALUES (?, ?, ?, ?)");
    stmt.run(result.period, result.number, result.bigSmall, result.color);
    stmt.finalize();

    io.emit('new_game_result', result);

    currentPeriod++;
    timeLeft = 60;
  }
}, 1000);

// --- User Auth APIs ---

// Register API
app.post('/api/register', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ success: false, message: 'ဖုန်းနံပါတ်နှင့် စကားဝှက် ရိုက်ထည့်ပါ' });

  const stmt = db.prepare("INSERT INTO users (phone, password, balance) VALUES (?, ?, 10000)");
  stmt.run(phone, password, function(err) {
    if (err) {
      return res.status(400).json({ success: false, message: 'ဒီဖုန်းနံပါတ်ဖြင့် အကောင့်ဖွင့်ပြီးသားဖြစ်သည်' });
    }
    res.json({ success: true, user: { phone: phone, balance: 10000 } });
  });
  stmt.finalize();
});

// Login API
app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  db.get("SELECT phone, balance FROM users WHERE phone = ? AND password = ?", [phone, password], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ success: false, message: 'ဖုန်းနံပါတ် သို့မဟုတ် စကားဝှက် မှားယွင်းနေသည်' });
    }
    res.json({ success: true, user: row });
  });
});

// Get User Profile & Balance
app.get('/api/user/:phone', (req, res) => {
  db.get("SELECT phone, balance FROM users WHERE phone = ?", [req.params.phone], (err, row) => {
    if (err || !row) return res.status(404).json({ success: false });
    res.json({ success: true, user: row });
  });
});

// Update Balance API
app.post('/api/user/update-balance', (req, res) => {
  const { phone, balance } = req.body;
  db.run("UPDATE users SET balance = ? WHERE phone = ?", [balance, phone], (err) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

// --- Game APIs ---
app.get('/api/history', (req, res) => {
  db.all("SELECT period, number, bigSmall, color FROM history ORDER BY id DESC LIMIT 20", [], (err, rows) => {
    if (err) res.json([]);
    else res.json(rows);
  });
});

app.post('/api/bet', (req, res) => {
  res.json({ success: true });
});

// Admin Route & APIs
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin1234') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Username သို့မဟုတ် Password မှားယွင်းနေပါသည်' });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/admin/set-next-number', (req, res) => {
  const { number } = req.body;
  forcedResultNumber = parseInt(number);
  res.json({ success: true, message: `နောက်ထွက်မည့်ဂဏန်းကို [ ${forcedResultNumber} ] ဟု သတ်မှတ်လိုက်ပါပြီ` });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

