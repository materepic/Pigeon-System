const checkHealth = require("./rules");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");

const app = express();

const session = require("express-session");

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");


app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: process.env.SESSION_SECRET || "change_me",
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: "lax", secure: process.env.NODE_ENV === "production" }
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
        name TEXT,
        pin TEXT
    )`);

    db.run(`
    CREATE TABLE IF NOT EXISTS feed_logs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker TEXT,
        pigeonId TEXT,
        amount TEXT,
        time TEXT
    )`);

    db.run(`
    CREATE TABLE IF NOT EXISTS health_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker TEXT,
        pigeon_id TEXT,
        issue TEXT,
        time TEXT
    )`);

    db.run(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_id INTEGER,
        credential_id TEXT UNIQUE,
        public_key TEXT,
        counter INTEGER DEFAULT 0,
        transports TEXT
    )`);

});

/* ---------- ROUTES ---------- */

// server test
app.get("/", (req,res)=>{
    res.sendFile(path.join(__dirname,"public","index.html"));
});


/* LOGIN (Database Based) */
app.post("/login",(req,res)=>{
  const { username, password } = req.body;

  // Manager login (env-based)
  if (
    username === (process.env.MANAGER_USER || "manager") &&
    password === (process.env.MANAGER_PASS || "admin123")
  ) {
    req.session.user = { role:"manager", name:"Manager" };
    return res.json({ status:"ok", role:"manager", name:"Manager" });
  }

  // Worker login (DB)
  db.get(
    "SELECT * FROM workers WHERE name=? AND pin=?",
    [username, password],
    (err, row) => {
      if (err) return res.status(500).json({ status:"fail" });
      if (!row) return res.json({ status:"fail" });

      req.session.user = { role:"worker", id: row.id, name: row.name };
      return res.json({ status:"ok", role:"worker", id: row.id, name: row.name });
    }
  );
});

//logout//
app.post("/logout",(req,res)=>{
  req.session.destroy(()=>res.json({status:"ok"}));
});

//Manager Dashboard Route//
app.get("/manager", requireManager, (req,res)=>{
  res.sendFile(path.join(__dirname, "public", "manager.html"));
});


//___Manager logs___//

//feed logs//
app.get("/api/manager/feed-logs", requireManager, (req,res)=>{
  db.all(`
    SELECT feed_logs.*, workers.name AS workerName
    FROM feed_logs
    LEFT JOIN workers ON feed_logs.worker = workers.id
    ORDER BY feed_logs.id DESC
    LIMIT 500
  `, [], (err, rows)=>{
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

//Health logs//
app.get("/api/manager/health-logs", requireManager, (req,res)=>{
  db.all(`
    SELECT health_reports.*
    FROM health_reports
    ORDER BY id DESC
    LIMIT 500
  `, [], (err, rows)=>{
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

//Worker Management//
app.get("/api/manager/workers", requireManager, (req,res)=>{
  db.all("SELECT id, name FROM workers ORDER BY id DESC", [], (err, rows)=>{
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post("/api/manager/workers", requireManager, (req,res)=>{
  const { name, pin } = req.body;
  if(!name || !pin) return res.status(400).json({error:"name & pin required"});

  db.run("INSERT INTO workers(name,pin) VALUES(?,?)", [name, pin], function(err){
    if(err) return res.status(500).json({error:"db error"});
    res.json({status:"ok", id:this.lastID});
  });
});

app.delete("/api/manager/workers/:id", requireManager, (req,res)=>{
  db.run("DELETE FROM workers WHERE id=?", [req.params.id], (err)=>{
    if(err) return res.status(500).json({error:"db error"});
    res.json({status:"ok"});
  });
});

//feedings per day//
app.get("/api/manager/stats", requireManager, (req,res)=>{
  db.all(`
    SELECT substr(time, 1, 10) AS day, COUNT(*) AS feedCount
    FROM feed_logs
    GROUP BY day
    ORDER BY day DESC
    LIMIT 14
  `, [], (err, rows)=>{
    if(err) return res.status(500).json([]);
    res.json(rows.reverse()); // oldest -> newest
  });
});

//web authn, fingerprint login//
app.post("/api/webauthn/register/options", requireManager, (req,res)=>{
  const { workerId } = req.body;
  if(!workerId) return res.status(400).json({error:"workerId required"});

  db.get("SELECT * FROM workers WHERE id=?", [workerId], (err, worker)=>{
    if(err || !worker) return res.status(404).json({error:"worker not found"});

    const rpID = process.env.RPID || "pigeon-system.onrender.com";
    const origin = process.env.ORIGIN || "https://pigeon-system.onrender.com";

    const options = generateRegistrationOptions({
      rpName: "Pigeon System",
      rpID,
      userID: String(worker.id),
      userName: worker.name,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    req.session.currentChallenge = options.challenge;
    req.session.webauthnRegisterWorkerId = worker.id;

    res.json(options);
  });
});

//verify registration and save credential//
app.post("/api/webauthn/register/verify", requireManager, async (req,res)=>{
  const rpID = process.env.RPID || "pigeon-system.onrender.com";
  const origin = process.env.ORIGIN || "https://pigeon-system.onrender.com";

  const expectedChallenge = req.session.currentChallenge;
  const workerId = req.session.webauthnRegisterWorkerId;

  if(!expectedChallenge || !workerId) return res.status(400).json({error:"no challenge"});

  let verification;
  try{
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  }catch(e){
    return res.status(400).json({ error:"registration failed" });
  }

  const { verified, registrationInfo } = verification;
  if(!verified || !registrationInfo) return res.status(400).json({ error:"not verified" });

  const { credentialPublicKey, credentialID, counter } = registrationInfo;

  db.run(
    "INSERT OR REPLACE INTO webauthn_credentials(worker_id, credential_id, public_key, counter, transports) VALUES(?,?,?,?,?)",
    [
      workerId,
      Buffer.from(credentialID).toString("base64url"),
      Buffer.from(credentialPublicKey).toString("base64url"),
      counter,
      JSON.stringify(req.body.response?.transports || [])
    ],
    (err)=>{
      if(err) return res.status(500).json({error:"db error"});
      res.json({status:"ok"});
    }
  );
});

//Login options//
app.post("/api/webauthn/login/options", (req,res)=>{
  const { workerName } = req.body;
  if(!workerName) return res.status(400).json({error:"workerName required"});

  db.get("SELECT * FROM workers WHERE name=?", [workerName], (err, worker)=>{
    if(err || !worker) return res.status(404).json({error:"worker not found"});

    db.all("SELECT * FROM webauthn_credentials WHERE worker_id=?", [worker.id], (err2, creds)=>{
      if(err2) return res.status(500).json({error:"db error"});

      const rpID = process.env.RPID || "pigeon-system.onrender.com";

      const options = generateAuthenticationOptions({
        rpID,
        allowCredentials: creds.map(c => ({
          id: Buffer.from(c.credential_id, "base64url"),
          type: "public-key",
        })),
        userVerification: "preferred",
      });

      req.session.currentChallenge = options.challenge;
      req.session.webauthnLoginWorkerId = worker.id;

      res.json(options);
    });
  });
});

//verify Login//
app.post("/api/webauthn/login/verify", async (req,res)=>{

  const rpID = process.env.RPID || "pigeon-system.onrender.com";
  const origin = process.env.ORIGIN || "https://pigeon-system.onrender.com";

  const expectedChallenge = req.session.currentChallenge;
  if(!expectedChallenge) return res.status(400).json({error:"No challenge"});

  const credentialID = req.body?.id;
  if(!credentialID) return res.status(400).json({error:"Missing credential id"});

  db.get(
    "SELECT * FROM webauthn_credentials WHERE credential_id=? LIMIT 1",
    [credentialID],
    async (err, cred)=>{

      if(err || !cred)
        return res.status(404).json({error:"Credential not found"});

      let verification;

      try{
        verification = await verifyAuthenticationResponse({
          response: req.body,
          expectedChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          authenticator: {
            credentialID: Buffer.from(cred.credential_id, "base64url"),
            credentialPublicKey: Buffer.from(cred.public_key, "base64url"),
            counter: cred.counter,
          },
        });
      }catch(e){
        console.log(e);
        return res.status(400).json({error:"Verification failed"});
      }

      const { verified, authenticationInfo } = verification;

      if(!verified)
        return res.status(400).json({error:"Not verified"});

      // update counter
      db.run(
        "UPDATE webauthn_credentials SET counter=? WHERE id=?",
        [authenticationInfo.newCounter, cred.id]
      );

      // get worker info
      db.get(
        "SELECT * FROM workers WHERE id=?",
        [cred.worker_id],
        (err2, worker)=>{
          if(err2 || !worker)
            return res.status(404).json({error:"Worker not found"});

          req.session.user = {
            role:"worker",
            id: worker.id,
            name: worker.name
          };

          res.json({
            status:"ok",
            role:"worker",
            id: worker.id,
            name: worker.name
          });
        }
      );
    }
  );
});





/* WORKERS */
app.get("/workers",(req,res)=>{
    db.all("SELECT * FROM workers",[],(err,rows)=>{
        if(err) return res.send(err);
        res.json(rows);
    });
});

app.post("/add-worker",(req,res)=>{
  return res.status(403).send("Disabled. Use Manager Dashboard.");
});




/* FEED LOG */
app.post("/feed",(req,res)=>{
const {worker,pigeonId,amount}=req.body;
const time=new Date().toLocaleString();

db.run(
"INSERT INTO feed_logs(worker,pigeonId,amount,time) VALUES(?,?,?,?)",
[worker,pigeonId,amount,time]
);

res.send("Feeding recorded");
});


/* HEALTH REPORT */
app.post("/health",(req,res)=>{
const {worker, pigeon_id, issue} = req.body;
const time = new Date().toLocaleString();

db.run(
"INSERT INTO health_reports(worker,pigeon_id,issue,time) VALUES(?,?,?,?)",
[worker,pigeon_id,issue,time],
err=>{
if(err) return res.send(err);

const advice = checkHealth(issue,"hot");

res.json({
status:"saved",
advice: advice
});
});

});


/* VIEW FEEDS */
app.get("/feeds",(req,res)=>{
db.all("SELECT * FROM feed_logs",[],(err,rows)=>{
if(err) return res.send(err);
res.json(rows);
});
});


/* VIEW HEALTH REPORTS */
app.get("/health-reports",(req,res)=>{
db.all("SELECT * FROM health_reports",[],(err,rows)=>{
if(err) return res.send(err);
res.json(rows);
});
});


/* FEEDING SCHEDULE */
app.get("/schedule",(req,res)=>{

const hour=new Date().getHours();

let message="";

if(hour<9)
message="Morning Feeding Time";

else if(hour<15)
message="Midday Check";

else if(hour<19)
message="Evening Feeding Time";

else
message="Rest Period";

res.send(message);
});


/* WEATHER GUIDE */
app.get("/weather-guide",(req,res)=>{

const weather="hot"; // placeholder

let advice="";

if(weather==="hot")
advice="Provide extra water and reduce feed";

else if(weather==="cold")
advice="Increase feed slightly and check shelter";

else if(weather==="rain")
advice="Keep pigeons sheltered and monitor illness risk";

res.send(advice);
});



/* FEED LOGS WITH NAMES */
app.get("/feed-logs",(req,res)=>{

db.all(`
SELECT feed_logs.*, workers.name 
FROM feed_logs
LEFT JOIN workers ON feed_logs.worker = workers.id
`,[],(err,rows)=>{
if(err) return res.send(err);
res.json(rows);
});

});



//auth
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  next();
}

function requireManager(req, res, next) {
  if (!req.session.user || req.session.user.role !== "manager") {
    return res.status(403).json({ error: "Manager only" });
  }
  next();
}


app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});


/* ---------- SERVER ---------- */
app.listen(3000, ()=>{
console.log("Server running on port 3000");
});
