const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Memory Store (Simple & Rock Solid for Free Tier)
let currentPeriod = 202608020001;
let timeLeft = 60;
let forcedResultNumber = null;
let gameHistory = [];
let activeBets = [];

setInterval(() => {
  timeLeft--;

  io.emit('timer_tick', {
    period: currentPeriod,
    timeLeft: timeLeft
  });

  if (timeLeft <= 0) {
    // Determine winner
    let winningNum;
    if (forcedResultNumber !== null && forcedResultNumber >= 0 && forcedResultNumber <= 9) {
      winningNum = forcedResultNumber;
      forcedResultNumber = null; // Reset forced
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
      color: colorText,
      bets: activeBets.filter(b => b.period === currentPeriod)
    };

    gameHistory.unshift(result);
    if (gameHistory.length > 20) gameHistory.pop();

    io.emit('new_game_result', result);

    currentPeriod++;
    timeLeft = 60;
    activeBets = []; // Reset bets for next round
  }
}, 1000);

// API Routes
app.get('/api/history', (req, res) => {
  res.json(gameHistory);
});

app.post('/api/bet', (req, res) => {
  const { period, selection, amount } = req.body;
  activeBets.push({ period, selection, amount });
  res.json({ success: true });
});

// Admin Route & API
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/admin/set-next-number', (req, res) => {
  const { number } = req.body;
  forcedResultNumber = parseInt(number);
  res.json({ success: true, message: `နောက်တစ်ကြိမ် ထွက်ဂဏန်းကို [ ${forcedResultNumber} ] ဟု သတ်မှတ်လိုက်ပါပြီ` });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  const { number } = req.body;
  forcedResultNumber = parseInt(number);
  res.json({ success: true, message: `နောက်တစ်ကြိမ်ထွက်ဂဏန်းကို [ ${forcedResultNumber} ] အဖြစ် သတ်မှတ်လိုက်ပါပြီ` });
});

// Admin Page လင့်ခ်အတွက် Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/transaction', (req, res) => {
  const { type, amount } = req.body;
  db.run(`INSERT INTO transactions (type, amount) VALUES (?, ?)`, [type, amount], function(err) {
    res.json({ success: true, message: "တောင်းဆိုမှု အောင်မြင်ပါသည်။ Admin အတည်ပြုပေးပါမည်။" });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

