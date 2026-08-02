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

const db = new sqlite3.Database('./lottery.db');

// Admin Credentials Configuration
const ADMIN_CREDENTIALS = {
  phone: '09999999999',
  password: 'admin123'
};

// Database Initial Setup
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, period INTEGER, number INTEGER, bigSmall TEXT, color TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, password TEXT, balance REAL DEFAULT 10000, status TEXT DEFAULT 'ACTIVE')`);
  db.run(`CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, period INTEGER, selection TEXT, amount REAL, status TEXT DEFAULT 'PENDING', winAmount REAL DEFAULT 0)`);
});

let currentPeriod = 202608020001;
let timeLeft = 60;
let forcedResultNumber = null;

// Game Timer Loop
setInterval(() => {
  timeLeft--;
  io.emit('timer_tick', { period: currentPeriod, timeLeft: timeLeft });

  if (timeLeft <= 0) {
    let winningNum = (forcedResultNumber !== null && forcedResultNumber >= 0 && forcedResultNumber <= 9) 
      ? forcedResultNumber 
      : Math.floor(Math.random() * 10);
    forcedResultNumber = null;

    const bsText = winningNum >= 5 ? "အကြီး" : "အသေး";
    let colorText = (winningNum === 0 || winningNum === 5) ? "ခရမ်း" : (winningNum % 2 === 0 ? "အနီ" : "အစိမ်း");

    const stmt = db.prepare("INSERT INTO history (period, number, bigSmall, color) VALUES (?, ?, ?, ?)");
    stmt.run(currentPeriod, winningNum, bsText, colorText);
    stmt.finalize();

    settleBets(currentPeriod, winningNum, bsText, colorText);

    io.emit('new_game_result', { period: currentPeriod, number: winningNum, bigSmall: bsText, color: colorText });
    currentPeriod++;
    timeLeft = 60;
  }
}, 1000);

function settleBets(period, num, bs, color) {
  db.all("SELECT * FROM bets WHERE period = ? AND status = 'PENDING'", [period], (err, bets) => {
    if (err || !bets) return;

    bets.forEach(bet => {
      let isWin = false;
      let multiplier = 2;

      if (bet.selection === num.toString()) { isWin = true; multiplier = 9; }
      else if (bet.selection === bs || bet.selection === color) { isWin = true; }

      const winAmt = isWin ? bet.amount * multiplier : 0;
      const status = isWin ? 'WIN' : 'LOSE';

      db.run("UPDATE bets SET status = ?, winAmount = ? WHERE id = ?", [status, winAmt, bet.id]);
      if (isWin) {
        db.run("UPDATE users SET balance = balance + ? WHERE phone = ?", [winAmt, bet.phone]);
      }

      io.emit(`bet_result_${bet.phone}`, {
        period: period,
        status: status,
        amount: bet.amount,
        winAmount: winAmt,
        selection: bet.selection
      });
    });
  });
}

// Admin Auth API
app.post('/api/admin/login', (req, res) => {
  const { phone, password } = req.body;
  if (phone === ADMIN_CREDENTIALS.phone && password === ADMIN_CREDENTIALS.password) {
    res.json({ success: true, token: 'ADMIN_SECRET_SESSION_TOKEN' });
  } else {
    res.status(401).json({ success: false, message: 'Admin အချက်အလက် မှားယွင်းနေပါသည်။' });
  }
});

// Admin Static Route
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Admin User Management APIs
app.get('/api/admin/users', (req, res) => {
  db.all("SELECT id, phone, balance, status FROM users ORDER BY id DESC", [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/admin/update-balance', (req, res) => {
  const { phone, balance } = req.body;
  db.run("UPDATE users SET balance = ? WHERE phone = ?", [balance, phone], (err) => {
    res.json({ success: !err });
  });
});

app.post('/api/admin/toggle-ban', (req, res) => {
  const { phone, status } = req.body;
  db.run("UPDATE users SET status = ? WHERE phone = ?", [status, phone], (err) => {
    res.json({ success: !err });
  });
});

app.post('/api/admin/set-result', (req, res) => {
  const { number } = req.body;
  forcedResultNumber = parseInt(number);
  res.json({ success: true, message: `နောက်ပွဲစဉ် ထွက်ဂဏန်းကို [ ${forcedResultNumber} ] အဖြစ် သတ်မှတ်လိုက်ပါပြီ` });
});

// Standard User APIs
app.post('/api/register', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ success: false, message: 'အချက်အလက် ဖြည့်ပါ' });

  const stmt = db.prepare("INSERT INTO users (phone, password, balance) VALUES (?, ?, 10000)");
  stmt.run(phone, password, function(err) {
    if (err) return res.status(400).json({ success: false, message: 'ဒီဖုန်းနံပါတ်ဖြင့် အကောင့်ရှိပြီးသားပါ' });
    res.json({ success: true, user: { phone: phone, balance: 10000 } });
  });
  stmt.finalize();
});

app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  db.get("SELECT phone, balance, status FROM users WHERE phone = ? AND password = ?", [phone, password], (err, row) => {
    if (err || !row) return res.status(401).json({ success: false, message: 'ဖုန်း သို့မဟုတ် စကားဝှက် မှားနေသည်' });
    if (row.status === 'BANNED') return res.status(403).json({ success: false, message: 'သင့်အကောင့် ပိတ်ခံထားရသည်' });
    res.json({ success: true, user: row });
  });
});

app.get('/api/user/:phone', (req, res) => {
  db.get("SELECT phone, balance FROM users WHERE phone = ?", [req.params.phone], (err, row) => {
    if (err || !row) return res.status(404).json({ success: false });
    res.json({ success: true, user: row });
  });
});

app.post('/api/bet', (req, res) => {
  const { phone, selection, amount } = req.body;
  if (timeLeft <= 10) return res.status(400).json({ success: false, message: 'ပွဲစဉ် ပိတ်ခါနီးဖြစ်သည်' });

  db.get("SELECT balance FROM users WHERE phone = ?", [phone], (err, row) => {
    if (err || !row) return res.status(404).json({ success: false });
    if (row.balance < amount) return res.status(400).json({ success: false, message: 'လက်ကျန်ငွေ မလုံလောက်ပါ' });

    db.run("UPDATE users SET balance = balance - ? WHERE phone = ?", [amount, phone], (err) => {
      if (err) return res.status(500).json({ success: false });
      const stmt = db.prepare("INSERT INTO bets (phone, period, selection, amount) VALUES (?, ?, ?, ?)");
      stmt.run(phone, currentPeriod, selection, amount);
      stmt.finalize();
      res.json({ success: true, newBalance: row.balance - amount });
    });
  });
});

app.get('/api/history', (req, res) => {
  db.all("SELECT period, number, bigSmall, color FROM history ORDER BY id DESC LIMIT 15", [], (err, rows) => {
    res.json(rows || []);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

