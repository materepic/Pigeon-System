const checkHealth = require("./rules");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(bodyParser.json());
app.use(cors());

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
});

/* ---------- ROUTES ---------- */

// server test
app.get("/", (req,res)=>{
    res.send("Pigeon System Running");
});

/* LOGIN (Database Based) */
app.post("/login",(req,res)=>{

const {username,password}=req.body;

db.get(
"SELECT * FROM workers WHERE name=? AND pin=?",
[username,password],
(err,row)=>{

if(err) return res.send(err);

if(!row)
return res.json({status:"fail"});

res.json({
status:"ok",
id:row.id,
name:row.name
});

});
});


/* WORKERS */
app.get("/workers",(req,res)=>{
    db.all("SELECT * FROM workers",[],(err,rows)=>{
        if(err) return res.send(err);
        res.json(rows);
    });
});

app.post("/add-worker",(req,res)=>{
    const {name,pin} = req.body;

    db.run(
        "INSERT INTO workers(name,pin) VALUES(?,?)",
        [name,pin],
        err=>{
            if(err) return res.send(err);
            res.send("Worker Added");
        }
    );
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


/* FINGERPRINT LOGIN */
app.post("/finger-login",(req,res)=>{
const id=req.body.id;

db.get("SELECT * FROM workers WHERE id=?",[id],(err,row)=>{
if(!row) return res.send("Denied");
res.json(row);
});
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


app.get("/create-test-user",(req,res)=>{
db.run("INSERT INTO workers(name,pin) VALUES('worker','1234')");
res.send("Test user created");
});


/* ---------- SERVER ---------- */
app.listen(3000, ()=>{
console.log("Server running on port 3000");
});
