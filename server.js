const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./game.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT,
    number INTEGER,
    big_small TEXT,
    color TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    socket_id TEXT,
    period TEXT,
    selection TEXT,
    amount REAL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    amount REAL,
    status TEXT DEFAULT 'PENDING'
  )`);
});

let currentPeriod = 202608020001;
let timeLeft = 60;
let forcedResultNumber = null; // Admin Control Override

setInterval(() => {
  timeLeft--;

  io.emit('timer_tick', {
    period: currentPeriod,
    timeLeft: timeLeft,
    canBet: timeLeft > 10
  });

  if (timeLeft <= 0) {
    // Determine winner: Admin forced number OR random
    let winningNum;
    if (forcedResultNumber !== null && forcedResultNumber >= 0 && forcedResultNumber <= 9) {
      winningNum = forcedResultNumber;
      forcedResultNumber = null; // Reset forced number
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

    // Save Game Result
    db.run(
      `INSERT INTO game_history (period, number, big_small, color) VALUES (?, ?, ?, ?)`,
      [currentPeriod, winningNum, bsText, colorText],
      function (err) {
        if (!err) {
          io.emit('new_game_result', {
            period: currentPeriod,
            number: winningNum,
            bigSmall: bsText,
            color: colorText
          });
        }
      }
    );

    currentPeriod++;
    timeLeft = 60;
  }
}, 1000);

// API Endpoints
app.get('/api/history', (req, res) => {
  db.all(`SELECT period, number, big_small, color FROM game_history ORDER BY id DESC LIMIT 10`, [], (err, rows) => {
    res.json(rows || []);
  });
});

// Place Bet
app.post('/api/bet', (req, res) => {
  const { socketId, period, selection, amount } = req.body;
  db.run(`INSERT INTO bets (socket_id, period, selection, amount) VALUES (?, ?, ?, ?)`,
    [socketId, period, selection, amount], (err) => {
      if (err) return res.status(500).json({ success: false });
      res.json({ success: true });
    });
});

// Admin Control APIs
app.post('/api/admin/set-next-number', (req, res) => {
  const { number } = req.body;
  forcedResultNumber = parseInt(number);
  res.json({ success: true, message: `နောက်တစ်ကြိမ်ထွက်ဂဏန်းကို [ ${forcedResultNumber} ] အဖြစ် သတ်မှတ်လိုက်ပါပြီ` });
});

app.get('/api/admin/transactions', (req, res) => {
  db.all(`SELECT * FROM transactions WHERE status = 'PENDING' ORDER BY id DESC`, [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/transaction', (req, res) => {
  const { type, amount } = req.body;
  db.run(`INSERT INTO transactions (type, amount) VALUES (?, ?)`, [type, amount], function(err) {
    res.json({ success: true, message: "တောင်းဆိုမှု အောင်မြင်ပါသည်။ Admin အတည်ပြုပေးပါမည်။" });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

