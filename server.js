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

const ADMIN_CREDENTIALS = {
  phone: '09999999999',
  password: 'admin123'
};

// Database Initial Setup
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, period INTEGER, number INTEGER, bigSmall TEXT, color TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, password TEXT, balance REAL DEFAULT 0, status TEXT DEFAULT 'ACTIVE')`);
  db.run(`CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, period INTEGER, selection TEXT, amount REAL, status TEXT DEFAULT 'PENDING', winAmount REAL DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, type TEXT, method TEXT, amount REAL, user_pay_phone TEXT, txn_id TEXT, admin_pay_number TEXT, status TEXT DEFAULT 'PENDING_ADMIN_NUMBER', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`INSERT OR IGNORE INTO users (phone, password, balance) VALUES (?, ?, 1000000)`, [ADMIN_CREDENTIALS.phone, ADMIN_CREDENTIALS.password]);
});

let currentPeriod = 202608020001;
let timeLeft = 60;
let forcedResults = {}; // Store forced results by period ID: { 202608020001: 9 }

db.get("SELECT period FROM history ORDER BY id DESC LIMIT 1", (err, row) => {
  if (!err && row && row.period) currentPeriod = row.period + 1;
});

// Game Engine Loop
setInterval(() => {
  timeLeft--;

  // Calculate Realtime Bet Stats for Admin
  db.all("SELECT selection, SUM(amount) as totalAmount FROM bets WHERE period = ? GROUP BY selection", [currentPeriod], (err, rows) => {
    let betSummary = {};
    let grandTotal = 0;
    if (rows) {
      rows.forEach(r => {
        betSummary[r.selection] = r.totalAmount;
        grandTotal += r.totalAmount;
      });
    }
    io.emit('timer_tick', { period: currentPeriod, timeLeft: timeLeft, betSummary: betSummary, grandTotal: grandTotal });
  });

  if (timeLeft <= 0) {
    let winningNum;
    if (forcedResults[currentPeriod] !== undefined && forcedResults[currentPeriod] !== null) {
      winningNum = forcedResults[currentPeriod];
      delete forcedResults[currentPeriod];
    } else {
      winningNum = Math.floor(Math.random() * 10);
    }

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
        period: period, status: status, amount: bet.amount, winAmount: winAmt, selection: bet.selection
      });
    });
  });
}

// Transaction APIs
app.post('/api/transaction/deposit-request', (req, res) => {
  const { phone, method, amount } = req.body;
  const stmt = db.prepare("INSERT INTO transactions (phone, type, method, amount, status) VALUES (?, 'Deposit', ?, ?, 'PENDING_ADMIN_NUMBER')");
  stmt.run(phone, method, amount, function(err) {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, txId: this.lastID });
  });
  stmt.finalize();
});

app.get('/api/transaction/check-status/:id', (req, res) => {
  db.get("SELECT * FROM transactions WHERE id = ?", [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).json({ success: false });
    res.json({ success: true, transaction: row });
  });
});

app.post('/api/transaction/deposit-confirm', (req, res) => {
  const { txId, userPayPhone, txnId } = req.body;
  db.run("UPDATE transactions SET user_pay_phone = ?, txn_id = ?, status = 'PENDING_APPROVAL' WHERE id = ?", [userPayPhone, txnId, txId], (err) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, message: 'ငွေသွင်းတောင်းဆိုမှု အတည်ပြုရန် စောင့်ဆိုင်းနေပါသည်' });
  });
});

app.post('/api/transaction/withdraw-request', (req, res) => {
  const { phone, method, amount, userPayPhone } = req.body;
  db.get("SELECT balance FROM users WHERE phone = ?", [phone], (err, row) => {
    if (err || !row || row.balance < amount) return res.status(400).json({ success: false, message: 'လက်ကျန်ငွေ မလုံလောက်ပါ' });

    const stmt = db.prepare("INSERT INTO transactions (phone, type, method, amount, user_pay_phone, status) VALUES (?, 'Withdraw', ?, ?, ?, 'PENDING_APPROVAL')");
    stmt.run(phone, method, amount, userPayPhone, function(err) {
      if (err) return res.status(500).json({ success: false });
      res.json({ success: true, message: 'ငွေထုတ်ယူမှု တောင်းဆိုပြီးပါပြီ' });
    });
    stmt.finalize();
  });
});

// Admin Transaction APIs
app.get('/api/admin/pending-transactions', (req, res) => {
  db.all("SELECT * FROM transactions WHERE status != 'APPROVED' AND status != 'REJECTED' ORDER BY id DESC", [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/admin/set-deposit-number', (req, res) => {
  const { txId, adminPayNumber } = req.body;
  db.run("UPDATE transactions SET admin_pay_number = ?, status = 'WAITING_USER_PAY' WHERE id = ?", [adminPayNumber, txId], (err) => {
    res.json({ success: !err });
  });
});

app.post('/api/admin/process-transaction', (req, res) => {
  const { txId, action } = req.body;
  db.get("SELECT * FROM transactions WHERE id = ?", [txId], (err, tx) => {
    if (err || !tx) return res.status(404).json({ success: false });

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    if (action === 'APPROVE') {
      if (tx.type === 'Deposit') {
        db.run("UPDATE users SET balance = balance + ? WHERE phone = ?", [tx.amount, tx.phone]);
      } else if (tx.type === 'Withdraw') {
        db.run("UPDATE users SET balance = balance - ? WHERE phone = ?", [tx.amount, tx.phone]);
      }
    }

    db.run("UPDATE transactions SET status = ? WHERE id = ?", [newStatus, txId], (err) => {
      res.json({ success: true });
    });
  });
});

app.post('/api/admin/set-period-result', (req, res) => {
  const { period, number } = req.body;
  forcedResults[parseInt(period)] = parseInt(number);
  res.json({ success: true, message: `ပွဲစဉ် [ ${period} ] ထွက်ဂဏန်းကို [ ${number} ] အဖြစ် သတ်မှတ်လိုက်ပါပြီ` });
});

// Admin Auth & User Management APIs
app.post('/api/admin/login', (req, res) => {
  const { phone, password } = req.body;
  if (phone === ADMIN_CREDENTIALS.phone && password === ADMIN_CREDENTIALS.password) {
    res.json({ success: true, token: 'ADMIN_SECRET_SESSION_TOKEN' });
  } else {
    res.status(401).json({ success: false, message: 'Admin အချက်အလက် မှားယွင်းနေပါသည်။' });
  }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/admin/users', (req, res) => {
  db.all("SELECT id, phone, balance, status FROM users ORDER BY id DESC", [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/admin/update-balance', (req, res) => {
  const { phone, balance } = req.body;
  db.run("UPDATE users SET balance = ? WHERE phone = ?", [balance, phone], (err) => res.json({ success: !err }));
});

app.post('/api/admin/toggle-ban', (req, res) => {
  const { phone, status } = req.body;
  db.run("UPDATE users SET status = ? WHERE phone = ?", [status, phone], (err) => res.json({ success: !err }));
});

// User Standard APIs
app.post('/api/register', (req, res) => {
  const { phone, password } = req.body;
  const stmt = db.prepare("INSERT INTO users (phone, password, balance) VALUES (?, ?, 0)");
  stmt.run(phone, password, (err) => {
    if (err) return res.status(400).json({ success: false, message: 'အကောင့်ရှိပြီးသားပါ' });
    res.json({ success: true, user: { phone, balance: 0 } });
  });
  stmt.finalize();
});

app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  db.get("SELECT phone, balance, status FROM users WHERE phone = ? AND password = ?", [phone, password], (err, row) => {
    if (err || !row) return res.status(401).json({ success: false, message: 'ဖုန်း/စကားဝှက် မှားပါသည်' });
    if (row.status === 'BANNED') return res.status(403).json({ success: false, message: 'အကောင့် ပိတ်ခံထားရသည်' });
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
    if (err || !row || row.balance < amount) return res.status(400).json({ success: false, message: 'လက်ကျန်ငွေ မလုံလောက်ပါ' });

    db.run("UPDATE users SET balance = balance - ? WHERE phone = ?", [amount, phone], (err) => {
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

