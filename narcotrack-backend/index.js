// ============================================================
// NarcTrack — Multi-Agency Backend API
// Node.js + Express + PostgreSQL + Google OAuth + JWT
// NYS 10 NYCRR §80.136 Compliant Recordkeeping
// ============================================================

require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Database migration (idempotent — safe to run on every startup) ───────────
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Agencies table
    await client.query(`
      CREATE TABLE IF NOT EXISTS agencies (
        id            SERIAL PRIMARY KEY,
        name          VARCHAR(255) NOT NULL UNIQUE,
        slug          VARCHAR(100) NOT NULL UNIQUE,
        primary_color VARCHAR(7)   NOT NULL DEFAULT '#3b82f6',
        nav_color     VARCHAR(7)   NOT NULL DEFAULT '#1e293b',
        accent_color  VARCHAR(7)   NOT NULL DEFAULT '#38bdf8',
        stocks        JSONB        NOT NULL DEFAULT '["Main Stock","Sub-Stock 1","Sub-Stock 2"]',
        created_at    TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // 2. Seed the two default agencies
    await client.query(`
      INSERT INTO agencies (name, slug, primary_color, nav_color, accent_color, stocks) VALUES
        ('Farmingdale Fire Department', 'farmingdale-fire',
         '#dc2626', '#7f1d1d', '#fca5a5',
         '["Main Stock","929","9299"]'),
        ('Bellmore Merrick EMS', 'bellmore-merrick',
         '#2563eb', '#1e3a8a', '#93c5fd',
         '["Main Stock","Unit 1","Unit 2"]')
      ON CONFLICT (slug) DO NOTHING
    `);

    // 3. Add new columns to users
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar     TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS agency_id  INTEGER REFERENCES agencies(id)`);

    // 4. Add agency_id to all record tables
    const recordTables = [
      "inventory","pending_administrations","administrations",
      "purchases","transfers","waste","audits","monthly_logs",
    ];
    for (const t of recordTables) {
      await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS agency_id INTEGER REFERENCES agencies(id)`);
    }

    // 5. Default all existing rows to agency 1 (Farmingdale)
    for (const t of ["users", ...recordTables]) {
      await client.query(`UPDATE ${t} SET agency_id = 1 WHERE agency_id IS NULL`);
    }

    // 6. Drop old single-agency stock CHECK constraints (agencies use different stock names)
    await client.query(`
      DO $$ DECLARE r RECORD; BEGIN
        FOR r IN SELECT conname, conrelid::regclass AS tname
                 FROM   pg_constraint
                 WHERE  contype = 'c' AND conname LIKE '%stock_check'
        LOOP EXECUTE 'ALTER TABLE ' || r.tname || ' DROP CONSTRAINT IF EXISTS ' || r.conname; END LOOP;
      END $$;
    `);

    // 7. Fix monthly_logs unique constraint to include agency_id
    await client.query(`ALTER TABLE monthly_logs DROP CONSTRAINT IF EXISTS monthly_logs_year_month_key`);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE monthly_logs
          ADD CONSTRAINT monthly_logs_agency_year_month_key UNIQUE (agency_id, year, month);
      EXCEPTION WHEN duplicate_table THEN NULL; END $$;
    `);

    await client.query("COMMIT");
    console.log("Migration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration error:", err.message);
  } finally {
    client.release();
  }
}
migrate();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === "production" },
}));
app.use(passport.initialize());
app.use(passport.session());

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function issueToken(user, agency) {
  return jwt.sign(
    {
      id: user.id, email: user.email,
      username: user.username || user.email,
      role: user.role, name: user.name, badge: user.badge,
      agency_id:      agency.id,
      agency_name:    agency.name,
      agency_slug:    agency.slug,
      agency_primary: agency.primary_color,
      agency_nav:     agency.nav_color,
      agency_accent:  agency.accent_color,
      agency_stocks:  agency.stocks,
    },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token provided" });
  try {
    req.user = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin access required" });
  next();
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  `${process.env.API_URL}/api/auth/google/callback`,
  passReqToCallback: true,
}, async (req, accessToken, refreshToken, profile, done) => {
  try {
    const email     = profile.emails[0].value;
    const agencyId  = req.session.oauth_agency_id || 1;

    // Find existing user in this agency
    const { rows } = await pool.query(
      "SELECT u.*, a.* FROM users u JOIN agencies a ON a.id=u.agency_id WHERE u.email=$1 AND u.agency_id=$2",
      [email, agencyId]
    );

    if (rows[0]) return done(null, rows[0]);

    // First-time Google user — create pending account for this agency
    const { rows: [newUser] } = await pool.query(
      `INSERT INTO users (email, name, google_id, role, badge, username, agency_id)
       VALUES ($1,$2,$3,'pending','UNASSIGNED',$1,$4) RETURNING *`,
      [email, profile.displayName, profile.id, agencyId]
    );
    // Attach agency info for token issuance
    const { rows: [ag] } = await pool.query("SELECT * FROM agencies WHERE id=$1", [agencyId]);
    newUser._agency = ag;
    return done(null, newUser);
  } catch (err) { return done(err, null); }
}));

passport.serializeUser((user, done) => done(null, { id: user.id, agency_id: user.agency_id }));
passport.deserializeUser(async ({ id, agency_id }, done) => {
  const { rows } = await pool.query(
    "SELECT u.*, a.id AS ag_id, a.name AS ag_name, a.slug, a.primary_color, a.nav_color, a.accent_color, a.stocks FROM users u JOIN agencies a ON a.id=u.agency_id WHERE u.id=$1",
    [id]
  );
  done(null, rows[0] || null);
});

// Google OAuth entry — store selected agency in session
app.get("/api/auth/google", (req, res, next) => {
  if (req.query.agency_id) req.session.oauth_agency_id = parseInt(req.query.agency_id);
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

// Google callback
app.get("/api/auth/google/callback",
  passport.authenticate("google", { failureRedirect: `${process.env.FRONTEND_URL}/login?error=auth_failed` }),
  async (req, res) => {
    if (!req.user) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_user`);
    if (req.user.role === "pending")
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=pending`);
    // Fetch agency for token
    const { rows: [ag] } = await pool.query("SELECT * FROM agencies WHERE id=$1", [req.user.agency_id]);
    if (!ag) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_agency`);
    const token = issueToken(req.user, ag);
    res.redirect(`${process.env.FRONTEND_URL}/auth-callback?token=${token}`);
  }
);

// ─── Public: list agencies (for login dropdown) ───────────────────────────────
app.get("/api/agencies", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, slug, primary_color, nav_color, accent_color FROM agencies ORDER BY name"
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Local login ──────────────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  try {
    const { username, password, agency_id } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing credentials" });
    if (!agency_id)             return res.status(400).json({ error: "Agency selection required" });

    const { rows } = await pool.query(
      "SELECT u.*, a.id AS ag_id, a.name AS ag_name, a.slug, a.primary_color, a.nav_color, a.accent_color, a.stocks FROM users u JOIN agencies a ON a.id=u.agency_id WHERE (u.username=$1 OR u.email=$1) AND u.agency_id=$2",
      [username.toLowerCase(), agency_id]
    );
    if (!rows[0])               return res.status(401).json({ error: "No account found with that username or email." });
    if (!rows[0].password_hash) return res.status(401).json({ error: "This account uses Google Sign-In. Please use the Google button to log in." });
    if (!await bcrypt.compare(password, rows[0].password_hash))
                                return res.status(401).json({ error: "Wrong password. Please try again." });
    if (rows[0].role === "pending")
                                return res.status(403).json({ error: "Account pending role assignment" });

    const agency = {
      id: rows[0].ag_id, name: rows[0].ag_name, slug: rows[0].slug,
      primary_color: rows[0].primary_color, nav_color: rows[0].nav_color,
      accent_color: rows[0].accent_color, stocks: rows[0].stocks,
    };
    res.json({ token: issueToken(rows[0], agency) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Token refresh
app.post("/api/auth/refresh", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT u.*, a.* FROM users u JOIN agencies a ON a.id=u.agency_id WHERE u.id=$1",
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    const ag = { id: rows[0].id, name: rows[0].name, slug: rows[0].slug,
                 primary_color: rows[0].primary_color, nav_color: rows[0].nav_color,
                 accent_color: rows[0].accent_color, stocks: rows[0].stocks };
    res.json({ token: issueToken(rows[0], ag) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Agency management ────────────────────────────────────────────────────────
app.get("/api/agency", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM agencies WHERE id=$1", [req.user.agency_id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/agency", auth, adminOnly, async (req, res) => {
  try {
    const { primary_color, nav_color, accent_color, stocks } = req.body;
    const { rows } = await pool.query(
      `UPDATE agencies SET
         primary_color = COALESCE($1, primary_color),
         nav_color     = COALESCE($2, nav_color),
         accent_color  = COALESCE($3, accent_color),
         stocks        = COALESCE($4, stocks)
       WHERE id=$5 RETURNING *`,
      [primary_color, nav_color, accent_color,
       stocks ? JSON.stringify(stocks) : null,
       req.user.agency_id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get("/api/users/me", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, name, badge, role, avatar,
              (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id=$1 AND agency_id=$2`,
      [req.user.id, req.user.agency_id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/users/me", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword, avatar } = req.body;
    const updates = []; const params = [];

    if (newPassword !== undefined) {
      if (newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
      if (newPassword !== confirmNewPassword) return res.status(400).json({ error: "Passwords do not match" });
      const { rows } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
      if (rows[0]?.password_hash) {
        if (!currentPassword) return res.status(400).json({ error: "Current password required" });
        if (!await bcrypt.compare(currentPassword, rows[0].password_hash))
          return res.status(401).json({ error: "Current password is incorrect" });
      }
      params.push(await bcrypt.hash(newPassword, 12));
      updates.push(`password_hash=$${params.length}`);
    }
    if (avatar !== undefined) { params.push(avatar); updates.push(`avatar=$${params.length}`); }
    if (!updates.length) return res.json({ ok: true });

    params.push(req.user.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(",")} WHERE id=$${params.length} RETURNING id,username,email,name,badge,role,avatar`,
      params
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/users", auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id,username,email,name,badge,role,avatar,created_at FROM users WHERE agency_id=$1 ORDER BY name",
      [req.user.agency_id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/users", auth, adminOnly, async (req, res) => {
  try {
    const { username, password, name, badge, role, email } = req.body;
    const hash = password ? await bcrypt.hash(password, 12) : null;
    const { rows } = await pool.query(
      `INSERT INTO users (username,email,password_hash,name,badge,role,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,username,email,name,badge,role`,
      [username?.toLowerCase(), email?.toLowerCase()||null, hash, name, badge, role||"user", req.user.agency_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Username or email already exists" });
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/users/:id", auth, adminOnly, async (req, res) => {
  try {
    const { role, badge, name, username, email } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET
         role=COALESCE($1,role), badge=COALESCE($2,badge), name=COALESCE($3,name),
         username=COALESCE($4,username), email=COALESCE($5,email)
       WHERE id=$6 AND agency_id=$7 RETURNING id,username,email,name,badge,role`,
      [role, badge, name,
       username ? username.toLowerCase() : null,
       email    ? email.toLowerCase()    : null,
       req.params.id, req.user.agency_id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Username or email already exists" });
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/users/:id", auth, adminOnly, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id)
      return res.status(400).json({ error: "Cannot delete your own account" });
    await pool.query("DELETE FROM users WHERE id=$1 AND agency_id=$2", [req.params.id, req.user.agency_id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── INVENTORY ────────────────────────────────────────────────────────────────
app.get("/api/inventory", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM inventory WHERE agency_id=$1 ORDER BY stock,drug",
      [req.user.agency_id]
    );
    const grouped = {};
    for (const r of rows) { if (!grouped[r.stock]) grouped[r.stock]=[]; grouped[r.stock].push(r); }
    res.json(grouped);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/inventory", auth, adminOnly, async (req, res) => {
  try {
    const d = req.body;
    const { rows } = await pool.query(
      `INSERT INTO inventory (stock,drug,conc,unit,qty,min_qty,manufacturer,lot,supplier,supplier_dea,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [d.stock,d.drug,d.conc,d.unit,d.qty,d.minQty||5,
       d.manufacturer,d.lot,d.supplier,d.supplierDEA,req.user.agency_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/inventory/:id/minqty", auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE inventory SET min_qty=$1 WHERE id=$2 AND agency_id=$3 RETURNING *",
      [req.body.minQty, req.params.id, req.user.agency_id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PENDING ADMINISTRATIONS ──────────────────────────────────────────────────
app.get("/api/pending", auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM pending_administrations WHERE agency_id=$1 ORDER BY created_at DESC",
      [req.user.agency_id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/pending", auth, async (req, res) => {
  const d = req.body;

  // Non-admin users must confirm password on every administration
  if (req.user.role !== "admin") {
    if (!d.confirmPassword)
      return res.status(400).json({ error: "Password confirmation is required to administer medication." });
    const { rows: ur } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    if (!ur[0]?.password_hash)
      return res.status(400).json({ error: "No password set. Please set a password in your Profile tab before administering medications." });
    if (!await bcrypt.compare(d.confirmPassword, ur[0].password_hash))
      return res.status(401).json({ error: "Incorrect password. Administration not recorded." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: inv } = await client.query(
      "SELECT qty FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3 AND agency_id=$4",
      [d.stock, d.drug, d.conc, req.user.agency_id]
    );
    if (!inv[0]) return res.status(404).json({ error: "Drug not found in this stock" });
    if (inv[0].qty < parseFloat(d.doseQty))
      return res.status(400).json({ error: "Insufficient inventory" });

    const { rows } = await client.query(
      `INSERT INTO pending_administrations
       (stock,drug,conc,dose,dose_qty,route,run_id,patient_name,complaint,
        provider_num,provider_name,md_name,md_sig,receiving_hospital,
        hospital_record_num,witness,waste_amt,waste_witness,waste_reason,logged_by,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [d.stock,d.drug,d.conc,d.dose,d.doseQty,d.route,d.runId,d.patientName,
       d.complaint,d.providerNum,d.providerName,d.mdName,d.mdSig,
       d.receivingHospital,d.hospitalRecordNum,d.witness,
       d.wasteAmt||0,d.wasteWitness||"",d.wasteReason||"",req.user.username,req.user.agency_id]
    );
    await client.query(
      "UPDATE inventory SET qty=qty-$1,updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4 AND agency_id=$5",
      [d.doseQty,d.stock,d.drug,d.conc,req.user.agency_id]
    );
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.post("/api/pending/:id/verify", auth, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [p] } = await client.query(
      "SELECT * FROM pending_administrations WHERE id=$1 AND agency_id=$2",
      [req.params.id, req.user.agency_id]
    );
    if (!p) return res.status(404).json({ error: "Pending record not found" });

    await client.query(
      `INSERT INTO administrations
       (stock,drug,conc,dose,dose_qty,route,run_id,patient_name,complaint,
        provider_num,provider_name,md_name,md_sig,receiving_hospital,
        hospital_record_num,witness,waste_amt,waste_witness,waste_reason,
        status,logged_by,verified_by,verified_at,verify_note,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               'verified',$20,$21,NOW(),$22,$23)`,
      [p.stock,p.drug,p.conc,p.dose,p.dose_qty,p.route,p.run_id,p.patient_name,
       p.complaint,p.provider_num,p.provider_name,p.md_name,p.md_sig,
       p.receiving_hospital,p.hospital_record_num,p.witness,
       p.waste_amt,p.waste_witness,p.waste_reason,
       p.logged_by,req.user.username,req.body.note||"",req.user.agency_id]
    );
    await client.query("DELETE FROM pending_administrations WHERE id=$1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.post("/api/pending/:id/reject", auth, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [p] } = await client.query(
      "SELECT * FROM pending_administrations WHERE id=$1 AND agency_id=$2",
      [req.params.id, req.user.agency_id]
    );
    if (!p) return res.status(404).json({ error: "Pending record not found" });
    if (!req.body.reason) return res.status(400).json({ error: "Rejection reason required" });

    await client.query(
      `INSERT INTO administrations
       (stock,drug,conc,dose,dose_qty,route,run_id,patient_name,complaint,
        provider_num,provider_name,md_name,md_sig,receiving_hospital,
        hospital_record_num,witness,waste_amt,waste_witness,waste_reason,
        status,logged_by,rejected_by,rejected_at,reject_reason,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               'rejected',$20,$21,NOW(),$22,$23)`,
      [p.stock,p.drug,p.conc,p.dose,p.dose_qty,p.route,p.run_id,p.patient_name,
       p.complaint,p.provider_num,p.provider_name,p.md_name,p.md_sig,
       p.receiving_hospital,p.hospital_record_num,p.witness,
       p.waste_amt,p.waste_witness,p.waste_reason,
       p.logged_by,req.user.username,req.body.reason,req.user.agency_id]
    );
    await client.query(
      "UPDATE inventory SET qty=qty+$1,updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4 AND agency_id=$5",
      [p.dose_qty,p.stock,p.drug,p.conc,req.user.agency_id]
    );
    await client.query("DELETE FROM pending_administrations WHERE id=$1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ─── ADMINISTRATIONS ──────────────────────────────────────────────────────────
app.get("/api/administrations", auth, async (req, res) => {
  try {
    const { year, month, stock, status, logged_by } = req.query;
    let q = "SELECT * FROM administrations WHERE agency_id=$1";
    const params = [req.user.agency_id];

    if (year)   { params.push(year);          q += ` AND EXTRACT(YEAR  FROM created_at)=$${params.length}`; }
    if (month)  { params.push(parseInt(month)+1); q += ` AND EXTRACT(MONTH FROM created_at)=$${params.length}`; }
    if (stock)  { params.push(stock);         q += ` AND stock=$${params.length}`; }
    if (status) { params.push(status);        q += ` AND status=$${params.length}`; }
    if (req.user.role !== "admin") {
      params.push(req.user.username);
      q += ` AND (logged_by=$${params.length} OR status='verified')`;
    }
    if (logged_by && req.user.role === "admin") {
      params.push(logged_by); q += ` AND logged_by=$${params.length}`;
    }
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PURCHASES ────────────────────────────────────────────────────────────────
app.get("/api/purchases", auth, adminOnly, async (req, res) => {
  try {
    const { year } = req.query;
    let q = "SELECT * FROM purchases WHERE agency_id=$1";
    const params = [req.user.agency_id];
    if (year) { params.push(year); q += ` AND EXTRACT(YEAR FROM created_at)=$${params.length}`; }
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/purchases", auth, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const d = req.body;
    const { rows } = await client.query(
      `INSERT INTO purchases (stock,drug,conc,unit,qty,supplier,supplier_dea,manufacturer,lot,received_by,logged_by,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [d.stock,d.drug,d.conc,d.unit,d.qty,d.supplier,d.supplierDEA,
       d.manufacturer,d.lot,d.receivedBy,req.user.username,req.user.agency_id]
    );
    const { rows: existing } = await client.query(
      "SELECT id FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3 AND agency_id=$4",
      [d.stock,d.drug,d.conc,req.user.agency_id]
    );
    if (existing[0]) {
      await client.query(
        "UPDATE inventory SET qty=qty+$1,lot=$2,manufacturer=$3,supplier=$4,supplier_dea=$5,updated_at=NOW() WHERE id=$6",
        [d.qty,d.lot,d.manufacturer,d.supplier,d.supplierDEA,existing[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO inventory (stock,drug,conc,unit,qty,min_qty,manufacturer,lot,supplier,supplier_dea,agency_id)
         VALUES ($1,$2,$3,$4,$5,5,$6,$7,$8,$9,$10)`,
        [d.stock,d.drug,d.conc,d.unit,d.qty,d.manufacturer,d.lot,d.supplier,d.supplierDEA,req.user.agency_id]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ─── TRANSFERS ────────────────────────────────────────────────────────────────
app.get("/api/transfers", auth, async (req, res) => {
  try {
    const { year } = req.query;
    let q = "SELECT * FROM transfers WHERE agency_id=$1";
    const params = [req.user.agency_id];
    if (year) { params.push(year); q += ` AND EXTRACT(YEAR FROM created_at)=$${params.length}`; }
    if (req.user.role !== "admin") q += " AND from_stock != 'Main Stock' AND to_stock != 'Main Stock'";
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/transfers", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const d = req.body;
    if (req.user.role !== "admin" && (d.fromStock === "Main Stock" || d.toStock === "Main Stock"))
      return res.status(403).json({ error: "Users cannot access Main Stock" });

    const { rows: fromInv } = await client.query(
      "SELECT qty FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3 AND agency_id=$4",
      [d.fromStock,d.drug,d.conc,req.user.agency_id]
    );
    if (!fromInv[0] || fromInv[0].qty < parseFloat(d.qty))
      return res.status(400).json({ error: "Insufficient inventory in source stock" });

    const { rows } = await client.query(
      `INSERT INTO transfers (from_stock,to_stock,drug,conc,unit,qty,transferred_by,witness,logged_by,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [d.fromStock,d.toStock,d.drug,d.conc,d.unit||"mL",d.qty,d.transferredBy,d.witness,req.user.username,req.user.agency_id]
    );
    await client.query(
      "UPDATE inventory SET qty=qty-$1,updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4 AND agency_id=$5",
      [d.qty,d.fromStock,d.drug,d.conc,req.user.agency_id]
    );
    const { rows: dest } = await client.query(
      "SELECT id FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3 AND agency_id=$4",
      [d.toStock,d.drug,d.conc,req.user.agency_id]
    );
    if (dest[0]) {
      await client.query("UPDATE inventory SET qty=qty+$1,updated_at=NOW() WHERE id=$2", [d.qty,dest[0].id]);
    } else {
      await client.query(
        `INSERT INTO inventory (stock,drug,conc,unit,qty,min_qty,manufacturer,lot,supplier,supplier_dea,agency_id)
         SELECT $1,drug,conc,unit,$2,3,manufacturer,lot,supplier,supplier_dea,$3
         FROM inventory WHERE stock=$4 AND drug=$5 AND conc=$6 AND agency_id=$3`,
        [d.toStock,d.qty,req.user.agency_id,d.fromStock,d.drug,d.conc]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ─── WASTE ────────────────────────────────────────────────────────────────────
app.get("/api/waste", auth, async (req, res) => {
  try {
    const { year } = req.query;
    let q = "SELECT * FROM waste WHERE agency_id=$1";
    const params = [req.user.agency_id];
    if (year) { params.push(year); q += ` AND EXTRACT(YEAR FROM created_at)=$${params.length}`; }
    if (req.user.role !== "admin") q += " AND stock != 'Main Stock'";
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/waste", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const d = req.body;
    if (req.user.role !== "admin" && d.stock === "Main Stock")
      return res.status(403).json({ error: "Users cannot access Main Stock" });

    const { rows } = await client.query(
      `INSERT INTO waste (stock,drug,conc,unit,qty,reason,disposed_by,witness,method,logged_by,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [d.stock,d.drug,d.conc,d.unit||"mL",d.qty,d.reason,d.disposedBy,d.witness,d.method,req.user.username,req.user.agency_id]
    );
    await client.query(
      "UPDATE inventory SET qty=GREATEST(0,qty-$1),updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4 AND agency_id=$5",
      [d.qty,d.stock,d.drug,d.conc,req.user.agency_id]
    );
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ─── AUDITS ───────────────────────────────────────────────────────────────────
app.get("/api/audits", auth, async (req, res) => {
  try {
    const { year } = req.query;
    let q = "SELECT * FROM audits WHERE agency_id=$1";
    const params = [req.user.agency_id];
    if (year) { params.push(year); q += ` AND EXTRACT(YEAR FROM created_at)=$${params.length}`; }
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/audits", auth, async (req, res) => {
  try {
    const d = req.body;
    const { rows } = await pool.query(
      "INSERT INTO audits (stock,auditor,witness,results,notes,logged_by,agency_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [d.stock,d.auditor,d.witness,JSON.stringify(d.results),d.notes||"",req.user.username,req.user.agency_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── MONTHLY LOGS ─────────────────────────────────────────────────────────────
app.get("/api/monthly-logs", auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM monthly_logs WHERE agency_id=$1 ORDER BY year DESC, month DESC",
      [req.user.agency_id]
    );
    const result = {};
    for (const r of rows) {
      result[`${r.year}-${String(r.month+1).padStart(2,"0")}`] = r;
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/monthly-logs", auth, adminOnly, async (req, res) => {
  try {
    const d = req.body;
    const { rows } = await pool.query(
      `INSERT INTO monthly_logs (year,month,reviewed_by,md_review,discrepancies,notes,
         admin_count,purchase_count,transfer_count,waste_count,saved_by,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (agency_id,year,month) DO UPDATE SET
         reviewed_by=$3,md_review=$4,discrepancies=$5,notes=$6,
         admin_count=$7,purchase_count=$8,transfer_count=$9,waste_count=$10,
         saved_by=$11,saved_at=NOW()
       RETURNING *`,
      [d.year,d.month,d.reviewedBy,d.mdReview,d.discrepancies,d.notes,
       d.admins,d.purchases,d.transfers,d.waste,req.user.username,req.user.agency_id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
app.get("/api/export/doh3850", auth, adminOnly, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || month === undefined) return res.status(400).json({ error: "year and month required" });
    const { rows } = await pool.query(
      `SELECT * FROM administrations WHERE status='verified' AND agency_id=$1
       AND EXTRACT(YEAR FROM created_at)=$2 AND EXTRACT(MONTH FROM created_at)=$3
       ORDER BY created_at ASC`,
      [req.user.agency_id, year, parseInt(month)+1]
    );
    const headers = ["Date","Time","Stock Location","Drug Name","Concentration",
      "Dose Administered","Quantity Withdrawn (mL)","Route","Run / Call ID",
      "Patient Name","Chief Complaint","AEMT Provider #","Provider Name",
      "Ordering Physician","MD Authorization","Receiving Hospital","Hospital Record #",
      "Witness","Waste Amount","Waste Witness","Waste Reason","Submitted By","Verified By","Date Verified","Verify Note"];
    const csvRows = rows.map(r => {
      const d = new Date(r.created_at);
      return [d.toLocaleDateString("en-US"),d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),
        r.stock,r.drug,r.conc,r.dose,r.dose_qty,r.route,r.run_id,r.patient_name,r.complaint,
        r.provider_num,r.provider_name,r.md_name,r.md_sig,r.receiving_hospital,r.hospital_record_num,
        r.witness,r.waste_amt||0,r.waste_witness||"",r.waste_reason||"",r.logged_by,r.verified_by,
        r.verified_at ? new Date(r.verified_at).toLocaleDateString("en-US") : "",r.verify_note||""]
        .map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",");
    });
    const mn = ["January","February","March","April","May","June","July","August","September","October","November","December"][parseInt(month)];
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition",`attachment; filename="DOH-3850_${mn}_${year}.csv"`);
    res.send([headers.map(h=>`"${h}"`).join(","),...csvRows].join("\r\n"));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/export/doh3851", auth, adminOnly, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || month === undefined) return res.status(400).json({ error: "year and month required" });
    const mn1 = parseInt(month)+1;
    const { rows: purchases } = await pool.query(
      `SELECT 'Purchase' as record_type,created_at,stock,drug,conc,qty,unit,supplier,supplier_dea,
              manufacturer,lot,received_by,logged_by,NULL as from_stock,NULL as to_stock,NULL as transferred_by,NULL as witness
       FROM purchases WHERE agency_id=$1 AND EXTRACT(YEAR FROM created_at)=$2 AND EXTRACT(MONTH FROM created_at)=$3`,
      [req.user.agency_id,year,mn1]
    );
    const { rows: transfers } = await pool.query(
      `SELECT 'Transfer' as record_type,created_at,to_stock as stock,drug,conc,qty,unit,NULL as supplier,
              NULL as supplier_dea,NULL as manufacturer,NULL as lot,NULL as received_by,logged_by,
              from_stock,to_stock,transferred_by,witness
       FROM transfers WHERE agency_id=$1 AND EXTRACT(YEAR FROM created_at)=$2 AND EXTRACT(MONTH FROM created_at)=$3`,
      [req.user.agency_id,year,mn1]
    );
    const { rows: inventory } = await pool.query(
      "SELECT * FROM inventory WHERE agency_id=$1 ORDER BY stock,drug",[req.user.agency_id]
    );
    const headers = ["Record Type","Date","Time","Stock","Drug","Concentration","Qty","Unit",
      "Supplier","DEA #","Manufacturer","Lot","Received/Transferred By","Witness","From Stock","To Stock","Logged By"];
    const allRows = [...purchases,...transfers].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    const csvRows = allRows.map(r => {
      const d = new Date(r.created_at);
      return [r.record_type,d.toLocaleDateString("en-US"),d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),
        r.stock,r.drug,r.conc,r.qty,r.unit||"mL",r.supplier||r.from_stock||"",r.supplier_dea||"",
        r.manufacturer||"",r.lot||"",r.received_by||r.transferred_by||"",r.witness||"",
        r.from_stock||"",r.to_stock||"",r.logged_by]
        .map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",");
    });
    csvRows.push(`""`);
    csvRows.push(`"CURRENT INVENTORY — ${new Date().toLocaleDateString("en-US")}"`);
    csvRows.push(["Stock","Drug","Conc","Qty","Unit","Manufacturer","Lot","Supplier","Supplier DEA"].map(h=>`"${h}"`).join(","));
    for (const i of inventory) {
      csvRows.push([i.stock,i.drug,i.conc,i.qty,i.unit,i.manufacturer,i.lot,i.supplier,i.supplier_dea]
        .map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(","));
    }
    const mn = ["January","February","March","April","May","June","July","August","September","October","November","December"][parseInt(month)];
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition",`attachment; filename="DOH-3851_${mn}_${year}.csv"`);
    res.send([headers.map(h=>`"${h}"`).join(","),...csvRows].join("\r\n"));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/export/annual", auth, adminOnly, async (req, res) => {
  try {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: "year required" });
    const { rows: admins }    = await pool.query(`SELECT * FROM administrations WHERE status='verified' AND agency_id=$1 AND EXTRACT(YEAR FROM created_at)=$2 ORDER BY created_at`,[req.user.agency_id,year]);
    const { rows: purchases } = await pool.query(`SELECT * FROM purchases WHERE agency_id=$1 AND EXTRACT(YEAR FROM created_at)=$2 ORDER BY created_at`,[req.user.agency_id,year]);
    const { rows: waste }     = await pool.query(`SELECT * FROM waste WHERE agency_id=$1 AND EXTRACT(YEAR FROM created_at)=$2 ORDER BY created_at`,[req.user.agency_id,year]);
    const summary = {};
    for (const a of admins) { const k=`${a.drug}|${a.conc}`; if(!summary[k]) summary[k]={drug:a.drug,conc:a.conc,administered:0,purchased:0,wasted:0}; summary[k].administered+=parseFloat(a.dose_qty||0); }
    for (const p of purchases) { const k=`${p.drug}|${p.conc}`; if(!summary[k]) summary[k]={drug:p.drug,conc:p.conc,administered:0,purchased:0,wasted:0}; summary[k].purchased+=parseFloat(p.qty||0); }
    for (const w of waste) { const k=`${w.drug}|${w.conc}`; if(!summary[k]) summary[k]={drug:w.drug,conc:w.conc,administered:0,purchased:0,wasted:0}; summary[k].wasted+=parseFloat(w.qty||0); }
    const lines = [
      `"NARCOTRACK — ${req.user.agency_name} — ANNUAL CONTROLLED SUBSTANCE REPORT"`,
      `"Year: ${year}"`,`"Generated: ${new Date().toLocaleString("en-US")}"`,`"NYS 10 NYCRR §80.136"`,`""`,
      `"ANNUAL DRUG SUMMARY"`,
      `"Drug","Concentration","Total Purchased","Total Administered","Total Wasted","Net Balance"`,
      ...Object.values(summary).map(s=>`"${s.drug}","${s.conc}","${s.purchased.toFixed(2)}","${s.administered.toFixed(2)}","${s.wasted.toFixed(2)}","${(s.purchased-s.administered-s.wasted).toFixed(2)}"`),
      `""`,`"ADMINISTRATION RECORDS (${admins.length} verified)"`,
      `"Date","Drug","Dose","Route","Run ID","Patient","Provider","MD","Hospital","Verified By"`,
      ...admins.map(a=>{const d=new Date(a.created_at);return `"${d.toLocaleDateString("en-US")}","${a.drug}","${a.dose}","${a.route}","${a.run_id}","${a.patient_name}","${a.provider_name}","${a.md_name}","${a.receiving_hospital}","${a.verified_by}"`;})
    ];
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition",`attachment; filename="NarcTrack_Annual_${year}.csv"`);
    res.send(lines.join("\r\n"));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`NarcTrack API running on port ${PORT}`));
