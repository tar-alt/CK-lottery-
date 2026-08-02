const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "data.json");

/* =========================
   DATABASE
========================= */

let db = {
  users: [],
  history: []
};

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (err) {
    console.log("Database load error:", err);
  }
}

function saveDB() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(db, null, 2)
  );
}

loadDB();

/* =========================
   ADMIN
========================= */

const ADMIN_PHONE =
  process.env.ADMIN_PHONE || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "123456";

/*
   Demo admin login:

   Username: admin
   Password: 123456

   Production မှာ environment variable
   ပြောင်းသုံးပါ။
*/

/* =========================
   GAME STATE
========================= */

let roundNumber = 1;

let remainingSeconds = 60;

let currentBets = {};

let roundOpen = true;

function getPeriod() {
  return "CK-" +
    String(roundNumber).padStart(6, "0");
}

function getColor(number) {

  if (number === 0 || number === 5) {
    return "ခရမ်း";
  }

  if ([1, 3, 6, 8].includes(number)) {
    return "အစိမ်း";
  }

  return "အနီ";
}

function getSize(number) {
  return number >= 5
    ? "အကြီး"
    : "အသေး";
}

/* =========================
   SAFE USER
========================= */

function publicUser(user) {

  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    unit: user.unit
  };

}

/* =========================
   FIND USER
========================= */

function findUser(phone) {

  return db.users.find(
    u => u.phone === phone
  );

}

/* =========================
   PLAYER ID
========================= */

function createPlayerID() {

  let id;

  do {

    id =
      "CK-" +
      Math.floor(
        10000000 +
        Math.random() * 90000000
      );

  } while (
    db.users.some(u => u.id === id)
  );

  return id;
}

/* =========================
   REGISTER
========================= */

app.post("/api/register", (req, res) => {

  const {
    phone,
    password,
    name
  } = req.body;

  if (!phone || !password) {

    return res.json({
      success: false,
      message: "ဖုန်းနံပါတ်နှင့် Password ဖြည့်ပါ"
    });

  }

  if (findUser(phone)) {

    return res.json({
      success: false,
      message: "ဒီအကောင့်ရှိပြီးသားပါ"
    });

  }

  const user = {

    id: createPlayerID(),

    phone,

    password,

    name:
      name ||
      "Player",

    unit: 0,

    bets: [],

    createdAt:
      new Date().toISOString()

  };

  db.users.push(user);

  saveDB();

  res.json({
    success: true,
    user: publicUser(user)
  });

});

/* =========================
   LOGIN
========================= */

app.post("/api/login", (req, res) => {

  const {
    phone,
    password
  } = req.body;

  if (
    phone === ADMIN_PHONE &&
    password === ADMIN_PASSWORD
  ) {

    return res.json({

      success: true,

      admin: true,

      user: {
        phone: ADMIN_PHONE,
        name: "Administrator"
      }

    });

  }

  const user = findUser(phone);

  if (
    !user ||
    user.password !== password
  ) {

    return res.json({

      success: false,

      message:
        "ဖုန်းနံပါတ် သို့မဟုတ် Password မှားနေပါတယ်"

    });

  }

  res.json({

    success: true,

    admin: false,

    user: publicUser(user)

  });

});

/* =========================
   GET USER
========================= */

app.get("/api/user/:phone", (req, res) => {

  const user =
    findUser(req.params.phone);

  if (!user) {

    return res.json({
      success: false
    });

  }

  res.json({

    success: true,

    user: publicUser(user)

  });

});

/* =========================
   ADMIN USERS
========================= */

app.get("/api/admin/users", (req, res) => {

  res.json({

    success: true,

    users: db.users.map(
      publicUser
    )

  });

});

/* =========================
   ADMIN ADD UNIT
========================= */

app.post(
  "/api/admin/unit",
  (req, res) => {

    const {
      phone,
      amount
    } = req.body;

    const value =
      Number(amount);

    if (
      !phone ||
      !Number.isFinite(value) ||
      value <= 0
    ) {

      return res.json({

        success: false,

        message:
          "Unit ပမာဏ မှားနေပါတယ်"

      });

    }

    const user =
      findUser(phone);

    if (!user) {

      return res.json({

        success: false,

        message:
          "Player မတွေ့ပါ"

      });

    }

    user.unit += value;

    saveDB();

    sendBalance(user);

    res.json({

      success: true,

      user: publicUser(user)

    });

  }
);

/* =========================
   ADMIN REMOVE UNIT
========================= */

app.post(
  "/api/admin/remove-unit",
  (req, res) => {

    const {
      phone,
      amount
    } = req.body;

    const value =
      Number(amount);

    if (
      !phone ||
      !Number.isFinite(value) ||
      value <= 0
    ) {

      return res.json({

        success: false,

        message:
          "Unit ပမာဏ မှားနေပါတယ်"

      });

    }

    const user =
      findUser(phone);

    if (!user) {

      return res.json({

        success: false,

        message:
          "Player မတွေ့ပါ"

      });

    }

    user.unit =
      Math.max(
        0,
        user.unit - value
      );

    saveDB();

    sendBalance(user);

    res.json({

      success: true,

      user: publicUser(user)

    });

  }
);

/* =========================
   BALANCE SOCKET UPDATE
========================= */

function sendBalance(user) {

  io.emit(
    "player_balance_update",
    {
      phone: user.phone,
      unit: user.unit
    }
  );

}

/* =========================
   GAME BET
========================= */

app.post("/api/bet", (req, res) => {

  const {
    phone,
    selection,
    amount
  } = req.body;

  const value =
    Number(amount);

  const user =
    findUser(phone);

  if (!user) {

    return res.json({
      success: false,
      message: "Player မတွေ့ပါ"
    });

  }

  if (!roundOpen) {

    return res.json({
      success: false,
      message:
        "ဒီ Round ပိတ်သွားပါပြီ"
    });

  }

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {

    return res.json({
      success: false,
      message:
        "Unit ပမာဏမှားနေပါတယ်"
    });

  }

  if (value > user.unit) {

    return res.json({
      success: false,
      message:
        "Unit မလုံလောက်ပါ"
    });

  }

  user.unit -= value;

  const bet = {

    id:
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .slice(2),

    phone: user.phone,

    playerId: user.id,

    selection,

    amount: value,

    period: getPeriod(),

    status: "PENDING"

  };

  if (!currentBets[user.phone]) {
    currentBets[user.phone] = [];
  }

  currentBets[user.phone].push(bet);

  user.bets.push(bet);

  saveDB();

  sendBalance(user);

  io.emit(
    "bet_count_update",
    getBetCount()
  );

  res.json({

    success: true,

    bet

  });

});

/* =========================
   BET COUNT
========================= */

function getBetCount() {

  let count = 0;

  Object.values(
    currentBets
  ).forEach(
    arr => count += arr.length
  );

  return count;

}

/* =========================
   ROUND RESULT
========================= */

function finishRound() {

  roundOpen = false;

  const winningNum =
    Math.floor(
      Math.random() * 10
    );

  const color =
    getColor(winningNum);

  const size =
    getSize(winningNum);

  const period =
    getPeriod();

  const results = [];

  Object.keys(
    currentBets
  ).forEach(phone => {

    const user =
      findUser(phone);

    if (!user) return;

    const bets =
      currentBets[phone] || [];

    bets.forEach(bet => {

      let won = false;

      /*
        Demo payout logic.
        Virtual Unit only.
      */

      if (
        bet.selection ===
        String(winningNum)
      ) {

        won = true;

      }

      if (
        bet.selection === color
      ) {

        won = true;

      }

      if (
        bet.selection === size
      ) {

        won = true;

      }

      let winAmount = 0;

      if (won) {

        winAmount =
          bet.amount * 2;

        user.unit += winAmount;

      }

      bet.status =
        won
          ? "WIN"
          : "LOSE";

      bet.winningNum =
        winningNum;

      bet.color =
        color;

      bet.size =
        size;

      bet.winAmount =
        winAmount;

      results.push({

        phone: user.phone,

        playerId: user.id,

        status:
          won
            ? "WIN"
            : "LOSE",

        amount:
          bet.amount,

        winAmount,

        period,

        winningNum,

        color,

        size

      });

    });

    saveDB();

  });

  const historyItem = {

    period,

    number:
      winningNum,

    color,

    size,

    createdAt:
      new Date().toISOString()

  };

  db.history.unshift(
    historyItem
  );

  db.history =
    db.history.slice(0, 30);

  saveDB();

  /* Send each player's result */

  results.forEach(result => {

    io.emit(
      "player_result",
      result
    );

  });

  /* Send new history */

  io.emit(
    "round_finished",
    {

      period,

      number:
        winningNum,

      color,

      size

    }

  );

  Object.keys(
    currentBets
  ).forEach(phone => {

    const user =
      findUser(phone);

    if (user) {
      sendBalance(user);
    }

  });

  currentBets = {};

  roundNumber++;

  remainingSeconds = 60;

  roundOpen = true;

}

/* =========================
   TIMER
========================= */

setInterval(() => {

  remainingSeconds--;

  if (
    remainingSeconds <= 0
  ) {

    finishRound();

  }

  io.emit(
    "game_tick",
    {

      period:
        getPeriod(),

      seconds:
        remainingSeconds,

      open:
        roundOpen,

      betCount:
        getBetCount()

    }
  );

}, 1000);

/* =========================
   SOCKET
========================= */

io.on(
  "connection",
  socket => {

    console.log(
      "Connected:",
      socket.id
    );

    socket.emit(
      "game_state",
      {

        period:
          getPeriod(),

        seconds:
          remainingSeconds,

        open:
          roundOpen,

        history:
          db.history.slice(0, 20),

        betCount:
          getBetCount()

      }
    );

    socket.on(
      "disconnect",
      () => {

        console.log(
          "Disconnected:",
          socket.id
        );

      }
    );

  }
);

/* =========================
   START SERVER
========================= */

server.listen(
  PORT,
  () => {

    console.log(
      `CK Multiplayer running on port ${PORT}`
    );

  }
);
