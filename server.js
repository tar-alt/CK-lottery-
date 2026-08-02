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

// History Table မရှိသေးပါက တည်ဆောက်ခြင်း
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

let currentPeriod = 202608020001;
let timeLeft = 60;
let forcedResultNumber = null;

// စာမျက်နှာစဖွင့်ချိန်တွင် နောက်ဆုံး ပွဲစဉ်နံပါတ်ကို Database မှ ယူခြင်း
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

    // Database ထဲသို့ မှတ်တမ်း သိမ်းဆည်းခြင်း
    const stmt = db.prepare("INSERT INTO history (period, number, bigSmall, color) VALUES (?, ?, ?, ?)");
    stmt.run(result.period, result.number, result.bigSmall, result.color);
    stmt.finalize();

    io.emit('new_game_result', result);

    currentPeriod++;
    timeLeft = 60;
  }
}, 1000);

// API Endpoints - Database မှ နောက်ဆုံး မှတ်တမ်း ၂၀ ကို ခေါ်ယူခြင်း
app.get('/api/history', (req, res) => {
  db.all("SELECT period, number, bigSmall, color FROM history ORDER BY id DESC LIMIT 20", [], (err, rows) => {
    if (err) {
      res.json([]);
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/bet', (req, res) => {
  res.json({ success: true });
});

// Admin Route & API
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

