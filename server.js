const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let currentPeriod = 202608020001;
let timeLeft = 60;
let forcedResultNumber = null;
let gameHistory = [];

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

    gameHistory.unshift(result);
    if (gameHistory.length > 20) gameHistory.pop();

    io.emit('new_game_result', result);

    currentPeriod++;
    timeLeft = 60;
  }
}, 1000);

// API Endpoints
app.get('/api/history', (req, res) => {
  res.json(gameHistory);
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

