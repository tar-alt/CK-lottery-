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

const db = new sqlite3.Database('./lottery.db', (err) => {
  if (err) console.error("Database Connection Error:", err);
  else console.log("Connected to SQLite Database.");
});

// Database Initialization
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, period INTEGER, number INTEGER, bigSmall TEXT, color TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, password TEXT, balance REAL DEFAULT 10000, status TEXT DEFAULT 'ACTIVE')`);
  db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, type TEXT, amount REAL, status TEXT DEFAULT 'PENDING', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, period INTEGER, selection TEXT, amount REAL, status TEXT DEFAULT 'PENDING', winAmount REAL DEFAULT 0)`);
});

let currentPeriod = 202608020001;
let timeLeft = 60;
let forcedResultNumber = null;

db.get("SELECT period FROM history ORDER BY id DESC LIMIT 1", (err, row) => {
  if (!err && row && row.period) currentPeriod = row.period + 1;
});

// Game Loop Engine
setInterval(() => {
  timeLeft--;
  io.emit('timer_tick', { period: currentPeriod, timeLeft: timeLeft });

  if (timeLeft <= 0) {
    let winningNum = (forcedResultNumber !== null && forcedResultNumber >= 0 && forcedResultNumber <= 9) ? forcedResultNumber : Math.floor(Math.random() * 10);
    forcedResultNumber = null;

    const bsText = winningNum >= 5 ? "အကြီး" : "အသေး";
    let colorText = (winningNum === 0) ? "ခရမ်း" : (winningNum === 5) ? "ခရမ်း" : (winningNum % 2 === 0 ? "အနီ" : "အစိမ်း");

    const result = { period: currentPeriod, number: winningNum, bigSmall: bsText, color: colorText };

    // Save Result
    const stmt = db.prepare("INSERT INTO history (period, number, bigSmall, color) VALUES (?, ?, ?, ?)");
    stmt.run(result.period, result.number, result.bigSmall, result.color);
    stmt.finalize();

    // Settle Bets
    settleBets(currentPeriod, winningNum, bsText, colorText);

    io.emit('new_game_result', result);
    currentPeriod++;
    timeLeft = 60;
  }
}, 1000);

// Bet Settlement Logic
function settleBets(period, num, bs, color) {
  db.all("SELECT * FROM bets WHERE period = ? AND status = 'PENDING'", [period], (err, bets) => {
    if (err || !bets) return;

    bets.forEach(bet => {
      let isWin = false;
      let multiplier = 2; // Default 2x

      if (bet.selection === num.toString()) {
        isWin = true;
        multiplier = 9; // Number Win 9x
      } else if (bet.selection === bs) {
        isWin = true;
      } else if (bet.selection === color) {
        isWin = true;
      }

      const winAmt = isWin ? bet.amount * multiplier : 0;
      const status = isWin ? 'WIN' : 'LOSE';

      db.run("UPDATE bets SET status = ?, winAmount = ? WHERE id = ?", [status, winAmt, bet.id]);

      if (isWin) {
        db.run("UPDATE users SET balance = balance + ? WHERE phone = ?", [winAmt, bet.phone]);
      }

      // Notify User via Socket
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

// --- User APIs ---
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
  db.get("SELECT phone, balance, status FROM users WHERE phone = ? AND password = ?", [phone, password], (err, row) => {
    if (err || !row) return res.status(401).json({ success: false, message: 'ဖုန်းနံပါတ် သို့မဟုတ် စကားဝှက် မှားယွင်းနေသည်' });
    if (row.status === 'BANNED') return res.status(403).json({ success: false, message: 'သင့်အကောင့် ပိတ်ခံထားရပါသည်' });
    res.json({ success: true, user: row });
  });
});

app.get('/api/user/:phone', (req, res) => {
  db.get("SELECT phone, balance FROM users WHERE phone = ?", [req.params.phone], (err, row) => {
    if (err || !row) return res.status(404).json({ success: false });
    res.json({ success: true, user: row });
  });
});

// Bet Placement API
app.post('/api/bet', (req, res) => {
  const { phone, selection, amount } = req.body;
  if (timeLeft <= 10) return res.status(400).json({ success: false, message: 'ပွဲစဉ် ပိတ်ခါနီးဖြစ်၍ လောင်း၍မရတော့ပါ' });

  db.get("SELECT balance FROM users WHERE phone = ?", [phone], (err, row) => {
    if (err || !row) return res.status(404).json({ success: false, message: 'User ရှာမတွေ့ပါ' });
    if (row.balance < amount) return res.status(400).json({ success: false, message: 'လက်ကျန်ငွေ မလုံလောက်ပါ' });

    // Deduct Balance
    db.run("UPDATE users SET balance = balance - ? WHERE phone = ?", [amount, phone], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Transaction Failed' });

      // Save Bet
      const stmt = db.prepare("INSERT INTO bets (phone, period, selection, amount) VALUES (?, ?, ?, ?)");
      stmt.run(phone, currentPeriod, selection, amount);
      stmt.finalize();

      res.json({ success: true, newBalance: row.balance - amount });
    });
  });
});

// Transactions
app.post('/api/transaction/request', (req, res) => {
  const { phone, type, amount } = req.body;
  db.run("INSERT INTO transactions (phone, type, amount) VALUES (?, ?, ?)", [phone, type, amount], (err) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, message: 'တောင်းဆိုမှု အောင်မြင်ပါသည်' });
  });
});

app.get('/api/transaction/history/:phone', (req, res) => {
  db.all("SELECT type, amount, status FROM transactions WHERE phone = ? ORDER BY id DESC LIMIT 10", [req.params.phone], (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/history', (req, res) => {
  db.all("SELECT period, number, bigSmall, color FROM history ORDER BY id DESC LIMIT 15", [], (err, rows) => {
    res.json(rows || []);
  });
});

// --- Admin Control APIs ---
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

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

app.get('/api/admin/pending-tx', (req, res) => {
  db.all("SELECT * FROM transactions WHERE status = 'PENDING' ORDER BY id DESC", [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/admin/process-tx', (req, res) => {
  const { id, action, phone, type, amount } = req.body;
  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  db.run("UPDATE transactions SET status = ? WHERE id = ?", [newStatus, id], (err) => {
    if (action === 'APPROVE') {
      if (type === 'Deposit') db.run("UPDATE users SET balance = balance + ? WHERE phone = ?", [amount, phone]);
      if (type === 'Withdraw') db.run("UPDATE users SET balance = balance - ? WHERE phone = ?", [amount, phone]);
    }
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
