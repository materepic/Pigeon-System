const path = require("path");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");

const checkHealth = require("./rules");

const app = express();
app.set("trust proxy", 1);

app.use(express.json());

// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

// Static (do NOT auto-serve index.html)
app.use(express.static(path.join(__dirname, "public"), { index: false }));

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
      worker_name TEXT,
      pigeon_code TEXT,
      amount_grams INTEGER,
      plan_name TEXT,
      time TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS health_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_name TEXT,
      pigeon_code TEXT,
      issue TEXT,
      advice TEXT,
      severity TEXT,
      time TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pigeons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT,
      sex TEXT,
      breed TEXT,
      color TEXT,
      dob TEXT,
      status TEXT DEFAULT 'active',
      loft_section TEXT,
      pair_code TEXT,
      morning_base_grams INTEGER,
      evening_base_grams INTEGER,
      diet_type TEXT DEFAULT 'standard',
      guidance TEXT,
      notes TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS races (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      location TEXT,
      race_date TEXT,
      status TEXT,
      distance_km INTEGER,
      notes TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS race_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER,
      pigeon_id INTEGER,
      role TEXT,
      result_position INTEGER,
      result_time TEXT,
      notes TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS feeding_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      morning_time TEXT,
      evening_time TEXT,
      morning_percent INTEGER,
      evening_percent INTEGER,
      hydration_note TEXT,
      active INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS race_plan_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      days_to_race_min INTEGER,
      days_to_race_max INTEGER,
      plan_name TEXT,
      message TEXT,
      active INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS breeding_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT,
      end_date TEXT,
      stage TEXT,
      notes TEXT,
      active INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS guidance_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      title TEXT,
      season TEXT,
      content TEXT,
      priority INTEGER DEFAULT 3,
      active INTEGER DEFAULT 1,
      updated_by TEXT,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audience TEXT,          -- manager, worker, all
      severity TEXT,          -- info, warning, critical
      title TEXT,
      message TEXT,
      link TEXT,
      pigeon_code TEXT,
      worker_name TEXT,
      created_at TEXT,
      resolved INTEGER DEFAULT 0,
      resolved_by TEXT,
      resolved_at TEXT
    )
  `);

  seedDefaults();
});

/* ---------- SEED DEFAULTS ---------- */
function seedDefaults() {
  // Plans
  const plans = [
    { name: "Base", morning_time: "06:00", evening_time: "17:30", morning_percent: 100, evening_percent: 100, hydration_note: "Fresh water always." },
    { name: "Race Prep", morning_time: "06:30", evening_time: "17:00", morning_percent: 90, evening_percent: 90, hydration_note: "Increase water checks; light feed." },
    { name: "Race Day", morning_time: "05:30", evening_time: "16:30", morning_percent: 70, evening_percent: 70, hydration_note: "Hydration focus; keep calm; avoid heavy feed." },
    { name: "Recovery", morning_time: "07:00", evening_time: "18:00", morning_percent: 110, evening_percent: 110, hydration_note: "Electrolytes + recovery support (as per guide)." },
  ];

  plans.forEach((p) => {
    db.run(
      `INSERT OR IGNORE INTO feeding_plans(name,morning_time,evening_time,morning_percent,evening_percent,hydration_note,active)
       VALUES(?,?,?,?,?,?,1)`,
      [p.name, p.morning_time, p.evening_time, p.morning_percent, p.evening_percent, p.hydration_note]
    );
  });

  // Race plan rules
  const rules = [
    { min: 0, max: 0, plan: "Race Day", msg: "Race today: Race Day plan active (lighter portions + hydration)." },
    { min: 1, max: 3, plan: "Race Day", msg: "Race close: Race Day plan active (lighter portions + hydration)." },
    { min: 4, max: 7, plan: "Race Prep", msg: "Race coming soon: Race Prep plan active (slightly reduced portions)." },
  ];

  rules.forEach((r) => {
    db.run(
      `INSERT INTO race_plan_rules(days_to_race_min,days_to_race_max,plan_name,message,active)
       SELECT ?,?,?,?,1
       WHERE NOT EXISTS(
         SELECT 1 FROM race_plan_rules WHERE days_to_race_min=? AND days_to_race_max=? AND plan_name=?
       )`,
      [r.min, r.max, r.plan, r.msg, r.min, r.max, r.plan]
    );
  });

  // Seed a few guidance articles if none exist
  db.get("SELECT COUNT(*) AS c FROM guidance_articles", [], (err, row) => {
    if (err) return;
    if (row && row.c === 0) {
      const now = new Date().toISOString();
      const seed = [
        {
          category: "handling",
          title: "Safe Handling",
          season: "all",
          content:
            "Hold the pigeon firmly but gently.\nSupport chest and wings.\nAvoid squeezing.\nKeep handling short.\nWash/sanitize hands before and after.\nSeparate sick pigeons immediately.",
        },
        {
          category: "newborn",
          title: "Newly Born Chick Care",
          season: "all",
          content:
            "Keep nest warm and dry.\nDo not over-handle newborns.\nCheck parents are feeding crop milk.\nObserve chick daily: warmth, movement, fullness.\nIf weak/not fed: notify management immediately.\nKeep bedding clean to reduce infection risk.",
        },
        {
          category: "race",
          title: "Race Preparation Basics",
          season: "race_prep",
          content:
            "Reduce heavy feed as race approaches.\nIncrease hydration checks.\nKeep loft calm; reduce stress.\nConfirm pigeon fitness; report any weakness.\nRecord all feedings accurately.",
        },
        {
          category: "breeding",
          title: "Breeding Season Overview",
          season: "all",
          content:
            "Pre-breeding: increase condition feed gradually.\nPairing: monitor bonding and aggression.\nIncubation: reduce disturbance; keep nest warm.\nHatching: keep clean; observe feeding.\nWeaning: introduce small feed gradually and monitor.",
        },
      ];

      seed.forEach((a) => {
        db.run(
          `INSERT INTO guidance_articles(category,title,season,content,priority,active,updated_by,updated_at)
           VALUES(?,?,?,?,3,1,?,?)`,
          [a.category, a.title, a.season, a.content, "system", now]
        );
      });
    }
  });
}

/* ---------- AUTH HELPERS ---------- */
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).send("Not logged in");
  next();
}
function requireManager(req, res, next) {
  if (!req.session.user || req.session.user.role !== "manager") return res.status(403).send("Manager only");
  next();
}

/* ---------- UTIL ---------- */
function nowStr() {
  return new Date().toLocaleString();
}
function isoDayOnly(d) {
  return d.toISOString().slice(0, 10);
}
function parseISODateOnly(s) {
  // "YYYY-MM-DD" -> Date at local noon to avoid timezone edge
  if (!s) return null;
  const [y, m, dd] = s.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !dd) return null;
  return new Date(y, m - 1, dd, 12, 0, 0);
}
function daysBetween(a, b) {
  // b - a in days
  const ms = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / ms);
}
function csvEscape(val) {
  const s = String(val ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/* ---------- FEEDING PLAN LOGIC ---------- */
function getNextUpcomingRace(cb) {
  const today = isoDayOnly(new Date());
  db.get(
    `SELECT * FROM races
     WHERE status='upcoming' AND race_date >= ?
     ORDER BY race_date ASC
     LIMIT 1`,
    [today],
    (err, row) => cb(err, row)
  );
}

function getActiveBreedingCycle(cb) {
  const today = isoDayOnly(new Date());
  db.get(
    `SELECT * FROM breeding_cycles
     WHERE active=1 AND start_date <= ? AND end_date >= ?
     ORDER BY id DESC LIMIT 1`,
    [today, today],
    (err, row) => cb(err, row)
  );
}

function choosePlan(nextRaceRow, cb) {
  // default Base
  if (!nextRaceRow) return cb(null, { plan_name: "Base", message: "Base plan active.", race: null, days_to_race: null });

  const raceDate = parseISODateOnly(nextRaceRow.race_date);
  const today = parseISODateOnly(isoDayOnly(new Date()));
  const d = daysBetween(today, raceDate);

  db.get(
    `SELECT * FROM race_plan_rules
     WHERE active=1 AND ? BETWEEN days_to_race_min AND days_to_race_max
     ORDER BY days_to_race_min ASC LIMIT 1`,
    [d],
    (err, rule) => {
      if (err) return cb(err);
      if (!rule) return cb(null, { plan_name: "Base", message: `Upcoming race in ${d} day(s), Base plan active.`, race: nextRaceRow, days_to_race: d });

      cb(null, { plan_name: rule.plan_name, message: rule.message + ` (Race in ${d} day(s))`, race: nextRaceRow, days_to_race: d });
    }
  );
}

function getPlanDetails(planName, cb) {
  db.get(`SELECT * FROM feeding_plans WHERE name=? AND active=1 LIMIT 1`, [planName], (err, row) => {
    if (err) return cb(err);
    if (!row) {
      return cb(null, {
        name: "Base",
        morning_time: "06:00",
        evening_time: "17:30",
        morning_percent: 100,
        evening_percent: 100,
        hydration_note: "Fresh water always.",
      });
    }
    cb(null, row);
  });
}

/* ---------- ROUTES ---------- */

// Home -> login
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Protected pages
app.get("/worker", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "worker.html"));
});
app.get("/manager", requireManager, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "manager.html"));
});

// Simple server check
app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

/* LOGIN */
app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ status: "fail", reason: "Missing fields" });

  // Manager
  const mUser = process.env.MANAGER_USER || "manager";
  const mPass = process.env.MANAGER_PASS || "admin123";
  if (username === mUser && password === mPass) {
    req.session.user = { role: "manager", name: "Manager" };
    return res.json({ status: "ok", role: "manager", name: "Manager" });
  }

  // Worker (DB)
  db.get("SELECT * FROM workers WHERE name=? AND pin=? LIMIT 1", [username, password], (err, row) => {
    if (err) return res.status(500).json({ status: "fail" });
    if (!row) return res.json({ status: "fail" });

    req.session.user = { role: "worker", name: row.name, worker_id: row.id };
    res.json({ status: "ok", role: "worker", name: row.name });
  });
});

/* LOGOUT */
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ status: "ok" }));
});

/* WORKER: TODAY PLAN (race-aware + breeding stage) */
app.get("/api/worker/today-plan", requireLogin, (req, res) => {
  getNextUpcomingRace((err, race) => {
    if (err) return res.status(500).json({});

    choosePlan(race, (err2, chosen) => {
      if (err2) return res.status(500).json({});

      getPlanDetails(chosen.plan_name, (err3, plan) => {
        if (err3) return res.status(500).json({});

        getActiveBreedingCycle((err4, cycle) => {
          if (err4) return res.status(500).json({});

          res.json({
            plan: {
              name: plan.name,
              morning_time: plan.morning_time,
              evening_time: plan.evening_time,
              morning_percent: plan.morning_percent,
              evening_percent: plan.evening_percent,
              hydration_note: plan.hydration_note,
            },
            message: chosen.message,
            race: chosen.race
              ? { title: chosen.race.title, race_date: chosen.race.race_date, location: chosen.race.location, days_to_race: chosen.days_to_race }
              : null,
            breeding: cycle ? { stage: cycle.stage, notes: cycle.notes, start_date: cycle.start_date, end_date: cycle.end_date } : null,
          });
        });
      });
    });
  });
});

/* WORKER: PIGEONS (profiles + recommended grams based on active plan) */
app.get("/api/worker/pigeons", requireLogin, (req, res) => {
  getNextUpcomingRace((err, race) => {
    if (err) return res.status(500).json([]);
    choosePlan(race, (err2, chosen) => {
      if (err2) return res.status(500).json([]);
      getPlanDetails(chosen.plan_name, (err3, plan) => {
        if (err3) return res.status(500).json([]);

        db.all(
          `SELECT code,name,sex,breed,color,dob,status,loft_section,pair_code,
                  morning_base_grams,evening_base_grams,diet_type,guidance,notes
           FROM pigeons
           WHERE status IS NULL OR status!='retired'
           ORDER BY code ASC`,
          [],
          (err4, rows) => {
            if (err4) return res.status(500).json([]);

            const out = rows.map((p) => {
              const mb = p.morning_base_grams ?? null;
              const eb = p.evening_base_grams ?? null;
              const recMorning = mb != null ? Math.round((mb * (plan.morning_percent || 100)) / 100) : null;
              const recEvening = eb != null ? Math.round((eb * (plan.evening_percent || 100)) / 100) : null;

              return {
                ...p,
                recommended: {
                  plan: plan.name,
                  morning_grams: recMorning,
                  evening_grams: recEvening,
                },
              };
            });

            res.json(out);
          }
        );
      });
    });
  });
});

/* WORKER: GUIDANCE LIBRARY (active articles) */
app.get("/api/worker/guidance", requireLogin, (req, res) => {
  const { category, season, q } = req.query || {};
  const where = [];
  const args = [];

  where.push("active=1");

  if (category) {
    where.push("category=?");
    args.push(category);
  }
  if (season) {
    where.push("(season=? OR season='all')");
    args.push(season);
  }
  if (q) {
    where.push("(title LIKE ? OR content LIKE ?)");
    args.push(`%${q}%`, `%${q}%`);
  }

  db.all(
    `SELECT id,category,title,season,content,priority,updated_at
     FROM guidance_articles
     WHERE ${where.join(" AND ")}
     ORDER BY priority ASC, id DESC`,
    args,
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

/* WORKER: NOTIFICATIONS (unresolved, audience worker/all) */
app.get("/api/worker/notifications", requireLogin, (req, res) => {
  db.all(
    `SELECT id,audience,severity,title,message,link,pigeon_code,worker_name,created_at
     FROM notifications
     WHERE resolved=0 AND (audience='all' OR audience='worker')
     ORDER BY id DESC
     LIMIT 50`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

/* FEED (worker records) */
app.post("/feed", requireLogin, (req, res) => {
  const { pigeon_code, amount_grams } = req.body || {};
  if (!pigeon_code || !amount_grams) return res.status(400).send("Missing pigeon_code or amount_grams");

  const workerName = req.session.user.name;

  getNextUpcomingRace((err, race) => {
    if (err) return res.status(500).send("Error");
    choosePlan(race, (err2, chosen) => {
      if (err2) return res.status(500).send("Error");

      const time = nowStr();
      db.run(
        `INSERT INTO feed_logs(worker_name,pigeon_code,amount_grams,plan_name,time)
         VALUES(?,?,?,?,?)`,
        [workerName, pigeon_code, parseInt(amount_grams, 10), chosen.plan_name, time],
        (err3) => {
          if (err3) return res.status(500).send("DB error");
          res.send("Feeding recorded");
        }
      );
    });
  });
});

/* HEALTH REPORT (worker records + notification triggers) */
app.post("/health", requireLogin, (req, res) => {
  const { pigeon_code, issue } = req.body || {};
  if (!pigeon_code || !issue) return res.status(400).json({ status: "fail", reason: "Missing fields" });

  const workerName = req.session.user.name;

  const result = checkHealth(issue);
  const advice = result.advice;
  const severity = result.severity;

  const time = nowStr();

  db.run(
    `INSERT INTO health_reports(worker_name,pigeon_code,issue,advice,severity,time)
     VALUES(?,?,?,?,?,?)`,
    [workerName, pigeon_code, issue, advice, severity, time],
    (err) => {
      if (err) return res.status(500).json({ status: "fail" });

      // Create manager notification for warning/critical
      if (severity === "critical" || severity === "warning") {
        const created_at = nowStr();
        const title = severity === "critical" ? "Critical Health Alert" : "Health Warning";
        const msg = `${pigeon_code} reported "${issue}" by ${workerName}. Guidance: ${advice}`;
        db.run(
          `INSERT INTO notifications(audience,severity,title,message,link,pigeon_code,worker_name,created_at,resolved)
           VALUES('manager',?,?,?,?,?,?,?,0)`,
          [severity, title, msg, "/manager", pigeon_code, workerName, created_at]
        );
      }

      res.json({ status: "ok", advice, severity });
    }
  );
});

/* ---------- MANAGER APIs ---------- */

/* Workers */
app.get("/api/manager/workers", requireManager, (req, res) => {
  db.all("SELECT id,name FROM workers ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post("/api/manager/workers", requireManager, (req, res) => {
  const { name, pin } = req.body || {};
  if (!name || !pin) return res.status(400).send("Missing name/pin");

  db.run("INSERT INTO workers(name,pin) VALUES(?,?)", [name.trim(), pin.trim()], (err) => {
    if (err) return res.status(500).send("DB error (name may already exist)");
    res.send("ok");
  });
});

app.delete("/api/manager/workers/:id", requireManager, (req, res) => {
  db.run("DELETE FROM workers WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).send("DB error");
    res.send("ok");
  });
});

/* Feeding Logs */
app.get("/api/manager/feed-logs", requireManager, (req, res) => {
  const { from, to, worker, pigeon } = req.query || {};
  const where = [];
  const args = [];

  if (from) {
    where.push("time >= ?");
    args.push(from);
  }
  if (to) {
    where.push("time <= ?");
    args.push(to);
  }
  if (worker) {
    where.push("worker_name = ?");
    args.push(worker);
  }
  if (pigeon) {
    where.push("pigeon_code = ?");
    args.push(pigeon);
  }

  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";

  db.all(
    `SELECT id,worker_name AS worker,pigeon_code AS pigeonId,amount_grams AS amount,plan_name,time
     FROM feed_logs
     ${w}
     ORDER BY id DESC
     LIMIT 500`,
    args,
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

/* Health Logs */
app.get("/api/manager/health-logs", requireManager, (req, res) => {
  db.all(
    `SELECT id,worker_name AS worker,pigeon_code AS pigeon_id,issue,advice,severity,time
     FROM health_reports
     ORDER BY id DESC
     LIMIT 500`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

/* Pigeons CRUD */
app.get("/api/manager/pigeons", requireManager, (req, res) => {
  db.all("SELECT * FROM pigeons ORDER BY code ASC", [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post("/api/manager/pigeons", requireManager, (req, res) => {
  const p = req.body || {};
  if (!p.code) return res.status(400).send("code required");

  db.run(
    `INSERT INTO pigeons(code,name,sex,breed,color,dob,status,loft_section,pair_code,morning_base_grams,evening_base_grams,diet_type,guidance,notes)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p.code.trim(),
      p.name || "",
      p.sex || "",
      p.breed || "",
      p.color || "",
      p.dob || "",
      p.status || "active",
      p.loft_section || "",
      p.pair_code || "",
      p.morning_base_grams ?? null,
      p.evening_base_grams ?? null,
      p.diet_type || "standard",
      p.guidance || "",
      p.notes || "",
    ],
    (err) => {
      if (err) return res.status(500).send("DB error (duplicate code?)");
      res.send("ok");
    }
  );
});

app.put("/api/manager/pigeons/:code", requireManager, (req, res) => {
  const code = req.params.code;
  const p = req.body || {};

  db.run(
    `UPDATE pigeons SET
      name=?,sex=?,breed=?,color=?,dob=?,status=?,loft_section=?,pair_code=?,
      morning_base_grams=?,evening_base_grams=?,diet_type=?,guidance=?,notes=?
     WHERE code=?`,
    [
      p.name || "",
      p.sex || "",
      p.breed || "",
      p.color || "",
      p.dob || "",
      p.status || "active",
      p.loft_section || "",
      p.pair_code || "",
      p.morning_base_grams ?? null,
      p.evening_base_grams ?? null,
      p.diet_type || "standard",
      p.guidance || "",
      p.notes || "",
      code,
    ],
    (err) => {
      if (err) return res.status(500).send("DB error");
      res.send("ok");
    }
  );
});

app.delete("/api/manager/pigeons/:code", requireManager, (req, res) => {
  db.run("DELETE FROM pigeons WHERE code=?", [req.params.code], (err) => {
    if (err) return res.status(500).send("DB error");
    res.send("ok");
  });
});

/* Races CRUD */
app.get("/api/manager/races", requireManager, (req, res) => {
  db.all("SELECT * FROM races ORDER BY race_date ASC", [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post("/api/manager/races", requireManager, (req, res) => {
  const r = req.body || {};
  if (!r.title || !r.race_date) return res.status(400).send("title and race_date required");

  db.run(
    `INSERT INTO races(title,location,race_date,status,distance_km,notes)
     VALUES(?,?,?,?,?,?)`,
    [r.title.trim(), r.location || "", r.race_date, r.status || "upcoming", r.distance_km ?? null, r.notes || ""],
    (err) => {
      if (err) return res.status(500).send("DB error");
      // Notification to all that a race exists
      db.run(
        `INSERT INTO notifications(audience,severity,title,message,link,created_at,resolved)
         VALUES('all','info',?,?,?, ?,0)`,
        ["New Race Added", `${r.title} on ${r.race_date}. Plan will adjust automatically as it gets closer.`, "/worker", nowStr()]
      );
      res.send("ok");
    }
  );
});

app.put("/api/manager/races/:id", requireManager, (req, res) => {
  const r = req.body || {};
  db.run(
    `UPDATE races SET title=?,location=?,race_date=?,status=?,distance_km=?,notes=? WHERE id=?`,
    [r.title || "", r.location || "", r.race_date || "", r.status || "upcoming", r.distance_km ?? null, r.notes || "", req.params.id],
    (err) => {
      if (err) return res.status(500).send("DB error");
      res.send("ok");
    }
  );
});

app.delete("/api/manager/races/:id", requireManager, (req, res) => {
  db.run("DELETE FROM races WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).send("DB error");
    res.send("ok");
  });
});

/* Breeding cycles (simple manager controls) */
app.get("/api/manager/breeding", requireManager, (req, res) => {
  db.all("SELECT * FROM breeding_cycles ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post("/api/manager/breeding", requireManager, (req, res) => {
  const b = req.body || {};
  if (!b.start_date || !b.end_date || !b.stage) return res.status(400).send("start_date, end_date, stage required");

  // Only one active cycle at a time (optional)
  db.run("UPDATE breeding_cycles SET active=0", [], () => {
    db.run(
      `INSERT INTO breeding_cycles(start_date,end_date,stage,notes,active) VALUES(?,?,?,?,1)`,
      [b.start_date, b.end_date, b.stage, b.notes || ""],
      (err) => {
        if (err) return res.status(500).send("DB error");
        db.run(
          `INSERT INTO notifications(audience,severity,title,message,link,created_at,resolved)
           VALUES('all','info',?,?,?, ?,0)`,
          ["Breeding Stage Updated", `Breeding stage set to "${b.stage}" (${b.start_date} to ${b.end_date}).`, "/worker", nowStr()]
        );
        res.send("ok");
      }
    );
  });
});

/* Guidance Articles CRUD */
app.get("/api/manager/guidance", requireManager, (req, res) => {
  db.all(
    `SELECT id,category,title,season,content,priority,active,updated_by,updated_at
     FROM guidance_articles
     ORDER BY category ASC, priority ASC, id DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

app.post("/api/manager/guidance", requireManager, (req, res) => {
  const g = req.body || {};
  if (!g.category || !g.title || !g.content) return res.status(400).send("category,title,content required");
  const updated_at = new Date().toISOString();

  db.run(
    `INSERT INTO guidance_articles(category,title,season,content,priority,active,updated_by,updated_at)
     VALUES(?,?,?,?,?,?,?,?)`,
    [g.category, g.title, g.season || "all", g.content, g.priority ?? 3, g.active ?? 1, req.session.user.name, updated_at],
    (err) => {
      if (err) return res.status(500).send("DB error");
      res.send("ok");
    }
  );
});

app.put("/api/manager/guidance/:id", requireManager, (req, res) => {
  const g = req.body || {};
  const updated_at = new Date().toISOString();

  db.run(
    `UPDATE guidance_articles SET category=?,title=?,season=?,content=?,priority=?,active=?,updated_by=?,updated_at=?
     WHERE id=?`,
    [g.category, g.title, g.season || "all", g.content, g.priority ?? 3, g.active ?? 1, req.session.user.name, updated_at, req.params.id],
    (err) => {
      if (err) return res.status(500).send("DB error");
      res.send("ok");
    }
  );
});

app.delete("/api/manager/guidance/:id", requireManager, (req, res) => {
  db.run("DELETE FROM guidance_articles WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).send("DB error");
    res.send("ok");
  });
});

/* Notifications (manager) */
app.get("/api/manager/notifications", requireManager, (req, res) => {
  const resolved = req.query?.resolved === "1" ? 1 : 0;
  db.all(
    `SELECT id,audience,severity,title,message,link,pigeon_code,worker_name,created_at,resolved,resolved_by,resolved_at
     FROM notifications
     WHERE resolved=?
     ORDER BY id DESC
     LIMIT 200`,
    [resolved],
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

app.post("/api/manager/notifications/:id/resolve", requireManager, (req, res) => {
  db.run(
    `UPDATE notifications SET resolved=1,resolved_by=?,resolved_at=? WHERE id=?`,
    [req.session.user.name, nowStr(), req.params.id],
    (err) => {
      if (err) return res.status(500).send("DB error");
      res.send("ok");
    }
  );
});

/* REPORTS: Weekly summary (simple) */
app.get("/api/manager/reports/summary", requireManager, (req, res) => {
  // last 7 days (rough string filter by time text isn't perfect; ok for now)
  // For production, store ISO timestamps. We'll keep simple.

  db.get("SELECT COUNT(*) AS c FROM feed_logs", [], (err, feedsCount) => {
    if (err) return res.status(500).json({});
    db.get("SELECT COUNT(*) AS c FROM health_reports", [], (err2, healthCount) => {
      if (err2) return res.status(500).json({});
      db.get("SELECT COUNT(*) AS c FROM pigeons", [], (err3, pigeonCount) => {
        if (err3) return res.status(500).json({});
        db.get("SELECT COUNT(*) AS c FROM races WHERE status='upcoming'", [], (err4, upRaces) => {
          if (err4) return res.status(500).json({});
          res.json({
            total_feeds: feedsCount.c,
            total_health_reports: healthCount.c,
            total_pigeons: pigeonCount.c,
            upcoming_races: upRaces.c,
          });
        });
      });
    });
  });
});

/* EXPORTS (CSV) */
app.get("/api/manager/export/feed_logs.csv", requireManager, (req, res) => {
  db.all(`SELECT worker_name,pigeon_code,amount_grams,plan_name,time FROM feed_logs ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).send("DB error");
    const header = ["worker_name", "pigeon_code", "amount_grams", "plan_name", "time"];
    const lines = [header.join(",")].concat(
      rows.map((r) =>
        [r.worker_name, r.pigeon_code, r.amount_grams, r.plan_name, r.time].map(csvEscape).join(",")
      )
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="feed_logs.csv"`);
    res.send(lines.join("\n"));
  });
});

app.get("/api/manager/export/health_reports.csv", requireManager, (req, res) => {
  db.all(`SELECT worker_name,pigeon_code,issue,advice,severity,time FROM health_reports ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).send("DB error");
    const header = ["worker_name", "pigeon_code", "issue", "advice", "severity", "time"];
    const lines = [header.join(",")].concat(
      rows.map((r) =>
        [r.worker_name, r.pigeon_code, r.issue, r.advice, r.severity, r.time].map(csvEscape).join(",")
      )
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="health_reports.csv"`);
    res.send(lines.join("\n"));
  });
});

app.get("/api/manager/export/pigeons.csv", requireManager, (req, res) => {
  db.all(`SELECT code,name,sex,breed,color,dob,status,loft_section,pair_code,morning_base_grams,evening_base_grams,diet_type,notes FROM pigeons ORDER BY code ASC`, [], (err, rows) => {
    if (err) return res.status(500).send("DB error");
    const header = ["code","name","sex","breed","color","dob","status","loft_section","pair_code","morning_base_grams","evening_base_grams","diet_type","notes"];
    const lines = [header.join(",")].concat(
      rows.map((r) =>
        header.map((k)=>csvEscape(r[k])).join(",")
      )
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="pigeons.csv"`);
    res.send(lines.join("\n"));
  });
});

app.get("/api/manager/export/races.csv", requireManager, (req, res) => {
  db.all(`SELECT title,location,race_date,status,distance_km,notes FROM races ORDER BY race_date ASC`, [], (err, rows) => {
    if (err) return res.status(500).send("DB error");
    const header = ["title","location","race_date","status","distance_km","notes"];
    const lines = [header.join(",")].concat(
      rows.map((r) =>
        header.map((k)=>csvEscape(r[k])).join(",")
      )
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="races.csv"`);
    res.send(lines.join("\n"));
  });
});

/* ---------- START ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});