const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const session = require("express-session");

const checkHealth = require("./rules");

const app = express();
app.set("trust proxy", 1);


app.use(bodyParser.json());
app.use(cors());

// Serve frontend files from /public
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// Sessions (manager + worker login)
app.use(session({
  secret: process.env.SESSION_SECRET || "CHANGE_THIS_SECRET",
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" // works on localhost + Render
  }
}));

/* ---------- DATABASE ---------- */
const db = new sqlite3.Database("pigeon.db", (err) => {
  if (err) console.log(err);
  else console.log("Database Connected");
});

/* ---------- TABLES ---------- */
db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      pin TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS feed_logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker TEXT,
      pigeonId TEXT,
      amount TEXT,
      time TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS health_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker TEXT,
      pigeon_id TEXT,
      issue TEXT,
      time TEXT
    )
  `);

  db.run(`
  CREATE TABLE IF NOT EXISTS pigeons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,          -- e.g. "Pigeon 1" or "P001"
    name TEXT,                 -- optional display name
    notes TEXT,                -- general notes
    feed_morning_grams INTEGER,
    feed_evening_grams INTEGER,
    guidance TEXT              -- long guidance / rules from management
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    location TEXT,
    race_date TEXT,            -- store as ISO string
    status TEXT,               -- "upcoming" or "done"
    notes TEXT
  )
`);

});

/* ---------- AUTH GUARDS ---------- */
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).send("Not logged in");
  next();
}

function requireManager(req, res, next) {
  if (!req.session.user || req.session.user.role !== "manager") {
    return res.status(403).send("Manager only");
  }
  next();
}

/* ---------- PAGES ---------- */
app.get("/", (req, res) => {
  // Always start at login
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/worker", requireLogin, (req, res) => {
  // Worker UI
  res.sendFile(path.join(__dirname, "public", "worker.html"));
});

app.get("/manager", requireManager, (req, res) => {
  // Manager UI
  res.sendFile(path.join(__dirname, "public", "manager.html"));
});

/* ---------- AUTH ROUTES ---------- */
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  // Manager login from env vars
  const managerUser = process.env.MANAGER_USER || "manager";
  const managerPass = process.env.MANAGER_PASS || "admin123";

  if (username === managerUser && password === managerPass) {
    req.session.user = { role: "manager", name: "Manager" };
    return res.json({ status: "ok", role: "manager", name: "Manager" });
  }

  // Worker login from DB
  db.get(
    "SELECT * FROM workers WHERE name=? AND pin=?",
    [username, password],
    (err, row) => {
      if (err) return res.status(500).json({ status: "fail" });
      if (!row) return res.json({ status: "fail" });

      req.session.user = { role: "worker", id: row.id, name: row.name };
      res.json({ status: "ok", role: "worker", id: row.id, name: row.name });
    }
  );
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ status: "ok" }));
});

// Home opens login page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Worker page (must be logged in)
app.get("/worker", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "worker.html"));
});

// Manager page (must be manager)
app.get("/manager", requireManager, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "manager.html"));
});

//worker recent feeding logs//
app.get("/api/worker/recent-feeds", requireLogin, (req,res)=>{
  db.all("SELECT worker, pigeonId, amount, time FROM feed_logs ORDER BY id DESC LIMIT 10", [], (err, rows)=>{
    if(err) return res.status(500).json([]);
    res.json(rows);
  });
});

/* ---------- WORKER ACTIONS ---------- */
app.post("/feed", requireLogin, (req, res) => {
  const { pigeonId, amount } = req.body;
  const time = new Date().toLocaleString();

  const workerName = req.session.user?.name || "Unknown";

  db.run(
    "INSERT INTO feed_logs(worker,pigeonId,amount,time) VALUES(?,?,?,?)",
    [workerName, pigeonId, amount, time],
    (err) => {
      if (err) return res.status(500).send("DB error");
      res.send("Feeding recorded");
    }
  );
});

app.post("/health", requireLogin, (req, res) => {
  const { pigeon_id, issue } = req.body;
  const time = new Date().toLocaleString();

  const workerName = req.session.user?.name || "Unknown";

  db.run(
    "INSERT INTO health_reports(worker,pigeon_id,issue,time) VALUES(?,?,?,?)",
    [workerName, pigeon_id, issue, time],
    (err) => {
      if (err) return res.status(500).send("DB error");

      const advice = checkHealth(issue, "hot");
      res.json({ status: "saved", advice });
    }
  );
});

/* ---------- GUIDANCE / INFO ---------- */
app.get("/schedule", (req, res) => {
  const hour = new Date().getHours();
  let message = "";

  if (hour < 9) message = "Morning Feeding Time";
  else if (hour < 15) message = "Midday Check";
  else if (hour < 19) message = "Evening Feeding Time";
  else message = "Rest Period";

  res.send(message);
});

app.get("/weather-guide", (req, res) => {
  const weather = "hot"; // placeholder
  let advice = "";

  if (weather === "hot") advice = "Provide extra water and reduce feed slightly";
  else if (weather === "cold") advice = "Increase feed slightly and ensure warmth";
  else if (weather === "rain") advice = "Keep pigeons sheltered and monitor illness risk";
  else advice = "Normal conditions: follow standard feeding guide";

  res.send(advice);
});

/* ---------- MANAGER APIs (PROTECTED) ---------- */

// Feeding logs (with worker name)
app.get("/api/manager/feed-logs", requireManager, (req, res) => {
  db.all(
    "SELECT * FROM feed_logs ORDER BY id DESC LIMIT 500",
    [],
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

// Health logs
app.get("/api/manager/health-logs", requireManager, (req, res) => {
  db.all(
    "SELECT * FROM health_reports ORDER BY id DESC LIMIT 500",
    [],
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

// List workers
app.get("/api/manager/workers", requireManager, (req, res) => {
  db.all("SELECT id, name FROM workers ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

// Add worker (manager only)
app.post("/api/manager/workers", requireManager, (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).send("name & pin required");

  db.run(
    "INSERT INTO workers(name,pin) VALUES(?,?)",
    [name.trim(), pin.trim()],
    function (err) {
      if (err) return res.status(500).send("DB error (maybe name already exists)");
      res.json({ status: "ok", id: this.lastID });
    }
  );
});

// Delete worker
app.delete("/api/manager/workers/:id", requireManager, (req, res) => {
  db.run("DELETE FROM workers WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).send("DB error");
    res.json({ status: "ok" });
  });
});

// Disable public add-worker route
app.post("/add-worker", (req, res) => {
  return res.status(403).send("Disabled. Use Manager Dashboard.");
});

//pigeons CRUD//
app.get("/api/manager/pigeons", requireManager, (req,res)=>{
  db.all("SELECT * FROM pigeons ORDER BY id DESC", [], (err, rows)=>{
    if(err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post("/api/manager/pigeons", requireManager, (req,res)=>{
  const { code, name, notes, feed_morning_grams, feed_evening_grams, guidance } = req.body;
  if(!code) return res.status(400).send("code required");

  db.run(
    `INSERT INTO pigeons(code,name,notes,feed_morning_grams,feed_evening_grams,guidance)
     VALUES(?,?,?,?,?,?)`,
    [code.trim(), name||"", notes||"", feed_morning_grams||null, feed_evening_grams||null, guidance||""],
    function(err){
      if(err) return res.status(500).send("DB error (maybe duplicate code)");
      res.json({status:"ok", id:this.lastID});
    }
  );
});

app.put("/api/manager/pigeons/:id", requireManager, (req,res)=>{
  const { code, name, notes, feed_morning_grams, feed_evening_grams, guidance } = req.body;
  db.run(
    `UPDATE pigeons SET code=?, name=?, notes=?, feed_morning_grams=?, feed_evening_grams=?, guidance=?
     WHERE id=?`,
    [code, name||"", notes||"", feed_morning_grams||null, feed_evening_grams||null, guidance||"", req.params.id],
    (err)=>{
      if(err) return res.status(500).send("DB error");
      res.json({status:"ok"});
    }
  );
});

app.delete("/api/manager/pigeons/:id", requireManager, (req,res)=>{
  db.run("DELETE FROM pigeons WHERE id=?", [req.params.id], (err)=>{
    if(err) return res.status(500).send("DB error");
    res.json({status:"ok"});
  });
});

//Races CRUD//
app.get("/api/manager/races", requireManager, (req,res)=>{
  db.all("SELECT * FROM races ORDER BY race_date ASC", [], (err, rows)=>{
    if(err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post("/api/manager/races", requireManager, (req,res)=>{
  const { title, location, race_date, status, notes } = req.body;
  if(!title || !race_date) return res.status(400).send("title & race_date required");

  db.run(
    `INSERT INTO races(title,location,race_date,status,notes) VALUES(?,?,?,?,?)`,
    [title.trim(), location||"", race_date, status||"upcoming", notes||""],
    function(err){
      if(err) return res.status(500).send("DB error");
      res.json({status:"ok", id:this.lastID});
    }
  );
});

app.put("/api/manager/races/:id", requireManager, (req,res)=>{
  const { title, location, race_date, status, notes } = req.body;
  db.run(
    `UPDATE races SET title=?, location=?, race_date=?, status=?, notes=? WHERE id=?`,
    [title||"", location||"", race_date||"", status||"upcoming", notes||"", req.params.id],
    (err)=>{
      if(err) return res.status(500).send("DB error");
      res.json({status:"ok"});
    }
  );
});

app.delete("/api/manager/races/:id", requireManager, (req,res)=>{
  db.run("DELETE FROM races WHERE id=?", [req.params.id], (err)=>{
    if(err) return res.status(500).send("DB error");
    res.json({status:"ok"});
  });
});

//Worker endpoint(read only)//
app.get("/api/worker/pigeons", requireLogin, (req,res)=>{
  db.all(
    "SELECT code, name, notes, feed_morning_grams, feed_evening_grams, guidance FROM pigeons ORDER BY id ASC",
    [],
    (err, rows)=>{
      if(err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

/* ---------- SERVER ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
