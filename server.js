const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);

// Enable CORS completely so any phone/client can connect smoothly
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('./game.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT,
    number INTEGER,
    big_small TEXT,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    amount REAL,
    status TEXT DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

let currentPeriod = 202608020001;
let timeLeft = 60;

// Central Game Loop
setInterval(() => {
  timeLeft--;

  // Send current time status to ALL connected clients
  io.emit('timer_tick', {
    period: currentPeriod,
    timeLeft: timeLeft,
    canBet: timeLeft > 15
  });

  if (timeLeft <= 0) {
    const winningNum = Math.floor(Math.random() * 10);
    const isBig = winningNum >= 5;
    const bsText = isBig ? "အကြီး" : "အသေး";

    let colorText = "";
    if (winningNum === 0) colorText = "အနီ/ခရမ်း";
    else if (winningNum === 5) colorText = "အစိမ်း/ခရမ်း";
    else if (winningNum % 2 === 0) colorText = "အနီရောင်";
    else colorText = "အစိမ်းရောင်";

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

// API Routes
app.get('/api/history', (req, res) => {
  db.all(`SELECT period, number, big_small, color FROM game_history ORDER BY id DESC LIMIT 10`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/transaction', (req, res) => {
  const { type, amount } = req.body;
  db.run(`INSERT INTO transactions (type, amount) VALUES (?, ?)`, [type, amount], function(err) {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, message: `${type === 'Deposit' ? 'ငွေသွင်း' : 'ငွေထုတ်'} တောင်းဆိုမှု အောင်မြင်ပါသည်။` });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

