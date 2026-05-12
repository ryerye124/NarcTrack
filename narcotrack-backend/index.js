// ============================================================
// NarcTrack EMS — Backend API
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

// ─── Auto-migration: add columns introduced after initial schema ───────────────
pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT").catch(() => {});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "10mb" })); // 10 MB — needed for base64 avatar uploads
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === "production" },
}));
app.use(passport.initialize());
app.use(passport.session());

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username || user.email,
      role: user.role, name: user.name, badge: user.badge },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token provided" });
  const token = header.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
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
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [email]);

    if (rows[0]) {
      return done(null, rows[0]);
    }

    // First time this Google account has logged in — create pending user
    const { rows: [newUser] } = await pool.query(
      `INSERT INTO users (email, name, google_id, role, badge, username)
       VALUES ($1, $2, $3, 'pending', 'UNASSIGNED', $1) RETURNING *`,
      [email, profile.displayName, profile.id]
    );
    return done(null, newUser);
  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
  done(null, rows[0] || null);
});

// Google login entry point
app.get("/api/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Google callback
app.get("/api/auth/google/callback",
  passport.authenticate("google", { failureRedirect: `${process.env.FRONTEND_URL}/login?error=auth_failed` }),
  (req, res) => {
    if (!req.user) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_user`);
    if (req.user.role === "pending") {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=pending`);
    }
    const token = issueToken(req.user);
    // Send token to frontend via URL — frontend grabs it and stores in memory
    res.redirect(`${process.env.FRONTEND_URL}/auth-callback?token=${token}`);
  }
);

// ─── Local login (optional fallback / admin bootstrap) ───────────────────────
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing credentials" });
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE username=$1 OR email=$1", [username.toLowerCase()]
    );
    if (!rows[0]) return res.status(401).json({ error: "Invalid credentials" });
    if (!rows[0].password_hash) return res.status(401).json({ error: "This account uses Google Sign-In" });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    if (rows[0].role === "pending") return res.status(403).json({ error: "Account pending role assignment" });
    const token = issueToken(rows[0]);
    res.json({ token, user: { id: rows[0].id, email: rows[0].email, username: rows[0].username, role: rows[0].role, name: rows[0].name, badge: rows[0].badge } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Token refresh
app.post("/api/auth/refresh", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json({ token: issueToken(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USERS ────────────────────────────────────────────────────────────────────

// Own profile — any authenticated user
app.get("/api/users/me", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, name, badge, role, avatar,
              (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update own profile — password change and/or avatar
app.patch("/api/users/me", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword, avatar } = req.body;
    const updates = [];
    const params  = [];

    if (newPassword !== undefined) {
      if (newPassword.length < 8)
        return res.status(400).json({ error: "New password must be at least 8 characters" });
      if (newPassword !== confirmNewPassword)
        return res.status(400).json({ error: "Passwords do not match" });

      const { rows } = await pool.query(
        "SELECT password_hash FROM users WHERE id=$1", [req.user.id]
      );
      // If account already has a password, require current password to change it
      if (rows[0]?.password_hash) {
        if (!currentPassword)
          return res.status(400).json({ error: "Current password required" });
        const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
        if (!valid)
          return res.status(401).json({ error: "Current password is incorrect" });
      }
      // Google-only users (no password_hash) can set their first password freely
      params.push(await bcrypt.hash(newPassword, 12));
      updates.push(`password_hash=$${params.length}`);
    }

    if (avatar !== undefined) {
      params.push(avatar); // null clears it
      updates.push(`avatar=$${params.length}`);
    }

    if (updates.length === 0) return res.json({ ok: true });

    params.push(req.user.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id=$${params.length}
       RETURNING id, username, email, name, badge, role, avatar`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All users list (admin only)
app.get("/api/users", auth, adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, username, email, name, badge, role, avatar, created_at FROM users ORDER BY name"
  );
  res.json(rows);
});

app.post("/api/users", auth, adminOnly, async (req, res) => {
  try {
    const { username, password, name, badge, role, email } = req.body;
    const hash = password ? await bcrypt.hash(password, 12) : null;
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash, name, badge, role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, name, badge, role`,
      [username?.toLowerCase(), email?.toLowerCase() || null, hash, name, badge, role || "user"]
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
         role     = COALESCE($1, role),
         badge    = COALESCE($2, badge),
         name     = COALESCE($3, name),
         username = COALESCE($4, username),
         email    = COALESCE($5, email)
       WHERE id=$6 RETURNING id, username, email, name, badge, role`,
      [role, badge, name,
       username ? username.toLowerCase() : null,
       email    ? email.toLowerCase()    : null,
       req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Username or email already exists" });
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/users/:id", auth, adminOnly, async (req, res) => {
  try {
    // Prevent deleting yourself
    if (parseInt(req.params.id) === req.user.id)
      return res.status(400).json({ error: "Cannot delete your own account" });
    await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INVENTORY ────────────────────────────────────────────────────────────────
app.get("/api/inventory", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM inventory ORDER BY stock, drug"
    );
    // Group by stock for frontend compatibility
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.stock]) grouped[row.stock] = [];
      grouped[row.stock].push(row);
    }
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/inventory", auth, adminOnly, async (req, res) => {
  try {
    const d = req.body;
    const { rows } = await pool.query(
      `INSERT INTO inventory (stock,drug,conc,unit,qty,min_qty,manufacturer,lot,supplier,supplier_dea)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [d.stock, d.drug, d.conc, d.unit, d.qty, d.minQty || 5,
       d.manufacturer, d.lot, d.supplier, d.supplierDEA]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/inventory/:id/minqty", auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE inventory SET min_qty=$1 WHERE id=$2 RETURNING *",
      [req.body.minQty, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PENDING ADMINISTRATIONS ──────────────────────────────────────────────────
app.get("/api/pending", auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM pending_administrations ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User submits administration → deducts inventory, creates pending record
app.post("/api/pending", auth, async (req, res) => {
  const d = req.body;

  // Non-admin users must confirm their password on every administration
  if (req.user.role !== "admin") {
    if (!d.confirmPassword)
      return res.status(400).json({ error: "Password confirmation is required to administer medication." });
    const { rows: ur } = await pool.query(
      "SELECT password_hash FROM users WHERE id=$1", [req.user.id]
    );
    if (!ur[0]?.password_hash)
      return res.status(400).json({ error: "No password set. Please set a password in your Profile tab before administering medications." });
    const ok = await bcrypt.compare(d.confirmPassword, ur[0].password_hash);
    if (!ok)
      return res.status(401).json({ error: "Incorrect password. Administration not recorded." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check inventory availability first
    const { rows: inv } = await client.query(
      "SELECT qty FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3",
      [d.stock, d.drug, d.conc]
    );
    if (!inv[0]) return res.status(404).json({ error: "Drug not found in this stock" });
    if (inv[0].qty < parseFloat(d.doseQty))
      return res.status(400).json({ error: "Insufficient inventory" });

    const { rows } = await client.query(
      `INSERT INTO pending_administrations
       (stock,drug,conc,dose,dose_qty,route,run_id,patient_name,complaint,
        provider_num,provider_name,md_name,md_sig,receiving_hospital,
        hospital_record_num,witness,waste_amt,waste_witness,waste_reason,logged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [d.stock,d.drug,d.conc,d.dose,d.doseQty,d.route,d.runId,d.patientName,
       d.complaint,d.providerNum,d.providerName,d.mdName,d.mdSig,
       d.receivingHospital,d.hospitalRecordNum,d.witness,
       d.wasteAmt||0,d.wasteWitness||"",d.wasteReason||"",req.user.username]
    );

    // Deduct inventory immediately
    await client.query(
      "UPDATE inventory SET qty=qty-$1, updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4",
      [d.doseQty, d.stock, d.drug, d.conc]
    );

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Admin verifies → moves to administrations table
app.post("/api/pending/:id/verify", auth, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [p] } = await client.query(
      "SELECT * FROM pending_administrations WHERE id=$1", [req.params.id]
    );
    if (!p) return res.status(404).json({ error: "Pending record not found" });

    await client.query(
      `INSERT INTO administrations
       (stock,drug,conc,dose,dose_qty,route,run_id,patient_name,complaint,
        provider_num,provider_name,md_name,md_sig,receiving_hospital,
        hospital_record_num,witness,waste_amt,waste_witness,waste_reason,
        status,logged_by,verified_by,verified_at,verify_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               'verified',$20,$21,NOW(),$22)`,
      [p.stock,p.drug,p.conc,p.dose,p.dose_qty,p.route,p.run_id,p.patient_name,
       p.complaint,p.provider_num,p.provider_name,p.md_name,p.md_sig,
       p.receiving_hospital,p.hospital_record_num,p.witness,
       p.waste_amt,p.waste_witness,p.waste_reason,
       p.logged_by, req.user.username, req.body.note||""]
    );

    await client.query("DELETE FROM pending_administrations WHERE id=$1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Admin rejects → restores inventory, moves to administrations as rejected
app.post("/api/pending/:id/reject", auth, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [p] } = await client.query(
      "SELECT * FROM pending_administrations WHERE id=$1", [req.params.id]
    );
    if (!p) return res.status(404).json({ error: "Pending record not found" });
    if (!req.body.reason) return res.status(400).json({ error: "Rejection reason required" });

    await client.query(
      `INSERT INTO administrations
       (stock,drug,conc,dose,dose_qty,route,run_id,patient_name,complaint,
        provider_num,provider_name,md_name,md_sig,receiving_hospital,
        hospital_record_num,witness,waste_amt,waste_witness,waste_reason,
        status,logged_by,rejected_by,rejected_at,reject_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               'rejected',$20,$21,NOW(),$22)`,
      [p.stock,p.drug,p.conc,p.dose,p.dose_qty,p.route,p.run_id,p.patient_name,
       p.complaint,p.provider_num,p.provider_name,p.md_name,p.md_sig,
       p.receiving_hospital,p.hospital_record_num,p.witness,
       p.waste_amt,p.waste_witness,p.waste_reason,
       p.logged_by, req.user.username, req.body.reason]
    );

    // Restore inventory
    await client.query(
      "UPDATE inventory SET qty=qty+$1, updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4",
      [p.dose_qty, p.stock, p.drug, p.conc]
    );

    await client.query("DELETE FROM pending_administrations WHERE id=$1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── ADMINISTRATIONS ──────────────────────────────────────────────────────────
app.get("/api/administrations", auth, async (req, res) => {
  try {
    const { year, month, stock, status, logged_by } = req.query;
    let q = "SELECT * FROM administrations WHERE 1=1";
    const params = [];

    if (year)      { params.push(year);      q += ` AND EXTRACT(YEAR FROM created_at)=$${params.length}`; }
    if (month)     { params.push(parseInt(month)+1); q += ` AND EXTRACT(MONTH FROM created_at)=$${params.length}`; }
    if (stock)     { params.push(stock);     q += ` AND stock=$${params.length}`; }
    if (status)    { params.push(status);    q += ` AND status=$${params.length}`; }
    // Users can only see their own + all verified; admins see everything
    if (req.user.role !== "admin") {
      params.push(req.user.username);
      q += ` AND (logged_by=$${params.length} OR status='verified')`;
    }
    if (logged_by && req.user.role === "admin") {
      params.push(logged_by);
      q += ` AND logged_by=$${params.length}`;
    }

    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin direct-log administration (goes straight to verified)
app.post("/api/administrations", auth, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const d = req.body;

    const { rows } = await client.query(
      `INSERT INTO administrations
       (stock,drug,conc,dose,dose_qty,route,run_id,patient_name,complaint,
        provider_num,provider_name,md_name,md_sig,receiving_hospital,
        hospital_record_num,witness,waste_amt,waste_witness,waste_reason,
        status,logged_by,verified_by,verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               'verified',$20,$20,NOW()) RETURNING *`,
      [d.stock,d.drug,d.conc,d.dose,d.doseQty,d.route,d.runId,d.patientName,
       d.complaint,d.providerNum,d.providerName,d.mdName,d.mdSig,
       d.receivingHospital,d.hospitalRecordNum,d.witness,
       d.wasteAmt||0,d.wasteWitness||"",d.wasteReason||"",req.user.username]
    );

    await client.query(
      "UPDATE inventory SET qty=qty-$1, updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4",
      [d.doseQty, d.stock, d.drug, d.conc]
    );

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── PURCHASES ────────────────────────────────────────────────────────────────
app.get("/api/purchases", auth, adminOnly, async (req, res) => {
  try {
    const { year } = req.query;
    let q = "SELECT * FROM purchases WHERE 1=1";
    const params = [];
    if (year) { params.push(year); q += ` AND EXTRACT(YEAR FROM created_at)=$${params.length}`; }
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/purchases", auth, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const d = req.body;

    const { rows } = await client.query(
      `INSERT INTO purchases (stock,drug,conc,unit,qty,supplier,supplier_dea,manufacturer,lot,received_by,logged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [d.stock,d.drug,d.conc,d.unit,d.qty,d.supplier,d.supplierDEA,
       d.manufacturer,d.lot,d.receivedBy,req.user.username]
    );

    // Add to or update inventory
    const { rows: existing } = await client.query(
      "SELECT id FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3",
      [d.stock, d.drug, d.conc]
    );
    if (existing[0]) {
      await client.query(
        "UPDATE inventory SET qty=qty+$1, lot=$2, manufacturer=$3, supplier=$4, supplier_dea=$5, updated_at=NOW() WHERE id=$6",
        [d.qty, d.lot, d.manufacturer, d.supplier, d.supplierDEA, existing[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO inventory (stock,drug,conc,unit,qty,min_qty,manufacturer,lot,supplier,supplier_dea)
         VALUES ($1,$2,$3,$4,$5,5,$6,$7,$8,$9)`,
        [d.stock,d.drug,d.conc,d.unit,d.qty,d.manufacturer,d.lot,d.supplier,d.supplierDEA]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── TRANSFERS ────────────────────────────────────────────────────────────────
app.get("/api/transfers", auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const { year } = req.query;
    let q = "SELECT * FROM transfers WHERE 1=1";
    const params = [];
    if (year) { params.push(year); q += ` AND EXTRACT(YEAR FROM created_at)=$${params.length}`; }
    // Users can only see sub-stock transfers (no main stock)
    if (!isAdmin) {
      q += " AND from_stock != 'Main Stock' AND to_stock != 'Main Stock'";
    }
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/transfers", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const d = req.body;

    // Users cannot transfer to/from Main Stock
    if (req.user.role !== "admin" &&
        (d.fromStock === "Main Stock" || d.toStock === "Main Stock")) {
      return res.status(403).json({ error: "Users cannot access Main Stock" });
    }

    const { rows: fromInv } = await client.query(
      "SELECT qty FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3",
      [d.fromStock, d.drug, d.conc]
    );
    if (!fromInv[0] || fromInv[0].qty < parseFloat(d.qty))
      return res.status(400).json({ error: "Insufficient inventory in source stock" });

    const { rows } = await client.query(
      `INSERT INTO transfers (from_stock,to_stock,drug,conc,unit,qty,transferred_by,witness,logged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.fromStock,d.toStock,d.drug,d.conc,d.unit||"mL",d.qty,d.transferredBy,d.witness,req.user.username]
    );

    await client.query(
      "UPDATE inventory SET qty=qty-$1, updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4",
      [d.qty, d.fromStock, d.drug, d.conc]
    );

    // Upsert destination
    const { rows: dest } = await client.query(
      "SELECT id FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3",
      [d.toStock, d.drug, d.conc]
    );
    if (dest[0]) {
      await client.query(
        "UPDATE inventory SET qty=qty+$1, updated_at=NOW() WHERE id=$2",
        [d.qty, dest[0].id]
      );
    } else {
      const src = fromInv[0];
      await client.query(
        `INSERT INTO inventory (stock,drug,conc,unit,qty,min_qty,manufacturer,lot,supplier,supplier_dea)
         SELECT $1,drug,conc,unit,$2,3,manufacturer,lot,$3,'' FROM inventory
         WHERE stock=$4 AND drug=$5 AND conc=$6`,
        [d.toStock, d.qty, d.fromStock, d.fromStock, d.drug, d.conc]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── WASTE ────────────────────────────────────────────────────────────────────
app.get("/api/waste", auth, async (req, res) => {
  try {
    const { year } = req.query;
    let q = "SELECT * FROM waste WHERE 1=1";
    const params = [];
    if (year) { params.push(year); q += ` AND EXTRACT(YEAR FROM created_at)=$${params.length}`; }
    if (req.user.role !== "admin") {
      q += " AND stock != 'Main Stock'";
    }
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/waste", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const d = req.body;

    if (req.user.role !== "admin" && d.stock === "Main Stock")
      return res.status(403).json({ error: "Users cannot access Main Stock" });

    const { rows } = await client.query(
      `INSERT INTO waste (stock,drug,conc,unit,qty,reason,disposed_by,witness,method,logged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [d.stock,d.drug,d.conc,d.unit||"mL",d.qty,d.reason,d.disposedBy,d.witness,d.method,req.user.username]
    );

    await client.query(
      "UPDATE inventory SET qty=GREATEST(0, qty-$1), updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4",
      [d.qty, d.stock, d.drug, d.conc]
    );

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── AUDITS ───────────────────────────────────────────────────────────────────
app.get("/api/audits", auth, async (req, res) => {
  try {
    const { year } = req.query;
    let q = "SELECT * FROM audits WHERE 1=1";
    const params = [];
    if (year) { params.push(year); q += ` AND EXTRACT(YEAR FROM created_at)=$${params.length}`; }
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/audits", auth, async (req, res) => {
  try {
    const d = req.body;
    const { rows } = await pool.query(
      `INSERT INTO audits (stock, auditor, witness, results, notes, logged_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.stock, d.auditor, d.witness, JSON.stringify(d.results), d.notes||"", req.user.username]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MONTHLY LOGS ─────────────────────────────────────────────────────────────
app.get("/api/monthly-logs", auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM monthly_logs ORDER BY year DESC, month DESC");
    // Return as object keyed by YYYY-MM for frontend compatibility
    const result = {};
    for (const row of rows) {
      const key = `${row.year}-${String(row.month + 1).padStart(2, "0")}`;
      result[key] = row;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/monthly-logs", auth, adminOnly, async (req, res) => {
  try {
    const d = req.body;
    const { rows } = await pool.query(
      `INSERT INTO monthly_logs (year, month, reviewed_by, md_review, discrepancies, notes,
        admin_count, purchase_count, transfer_count, waste_count, saved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (year, month) DO UPDATE SET
         reviewed_by=$3, md_review=$4, discrepancies=$5, notes=$6,
         admin_count=$7, purchase_count=$8, transfer_count=$9, waste_count=$10,
         saved_by=$11, saved_at=NOW()
       RETURNING *`,
      [d.year, d.month, d.reviewedBy, d.mdReview, d.discrepancies, d.notes,
       d.admins, d.purchases, d.transfers, d.waste, req.user.username]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── EXPORTS — DOH-3850 & DOH-3851 ───────────────────────────────────────────
// DOH-3850: Controlled Substance Administration Record
app.get("/api/export/doh3850", auth, adminOnly, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || month === undefined)
      return res.status(400).json({ error: "year and month required" });

    const { rows } = await pool.query(
      `SELECT * FROM administrations
       WHERE status='verified'
         AND EXTRACT(YEAR FROM created_at)=$1
         AND EXTRACT(MONTH FROM created_at)=$2
       ORDER BY created_at ASC`,
      [year, parseInt(month) + 1]
    );

    // NYS DOH-3850 column layout
    const headers = [
      "Date","Time","Stock Location","Drug Name","Concentration",
      "Dose Administered","Quantity Withdrawn (mL)","Route",
      "Run / Call ID","Patient Name","Chief Complaint / Presenting Problem",
      "AEMT Provider #","Provider Name","Ordering Physician",
      "MD Authorization / Signature","Receiving Hospital","Hospital Record #",
      "Witness","Waste Amount","Waste Witness","Waste Reason",
      "Record Submitted By","Verified By","Date Verified","Verification Note"
    ];

    const csvRows = rows.map(r => {
      const d = new Date(r.created_at);
      return [
        d.toLocaleDateString("en-US"),
        d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        r.stock,
        r.drug,
        r.conc,
        r.dose,
        r.dose_qty,
        r.route,
        r.run_id,
        r.patient_name,
        r.complaint,
        r.provider_num,
        r.provider_name,
        r.md_name,
        r.md_sig,
        r.receiving_hospital,
        r.hospital_record_num,
        r.witness,
        r.waste_amt || 0,
        r.waste_witness || "",
        r.waste_reason || "",
        r.logged_by,
        r.verified_by,
        r.verified_at ? new Date(r.verified_at).toLocaleDateString("en-US") : "",
        r.verify_note || "",
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    });

    const monthName = ["January","February","March","April","May","June",
      "July","August","September","October","November","December"][parseInt(month)];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition",
      `attachment; filename="DOH-3850_${monthName}_${year}.csv"`);
    res.send([headers.map(h => `"${h}"`).join(","), ...csvRows].join("\r\n"));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DOH-3851: Controlled Substance Inventory / Purchase Record
app.get("/api/export/doh3851", auth, adminOnly, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || month === undefined)
      return res.status(400).json({ error: "year and month required" });

    // Get purchases for this month
    const { rows: purchases } = await pool.query(
      `SELECT 'Purchase' as record_type, created_at, stock, drug, conc, qty, unit,
              supplier, supplier_dea, manufacturer, lot, received_by, logged_by,
              NULL as from_stock, NULL as to_stock, NULL as transferred_by, NULL as witness
       FROM purchases
       WHERE EXTRACT(YEAR FROM created_at)=$1 AND EXTRACT(MONTH FROM created_at)=$2`,
      [year, parseInt(month) + 1]
    );

    // Get transfers for this month
    const { rows: transfers } = await pool.query(
      `SELECT 'Transfer' as record_type, created_at, to_stock as stock, drug, conc, qty, unit,
              NULL as supplier, NULL as supplier_dea, NULL as manufacturer, NULL as lot,
              NULL as received_by, logged_by, from_stock, to_stock, transferred_by, witness
       FROM transfers
       WHERE EXTRACT(YEAR FROM created_at)=$1 AND EXTRACT(MONTH FROM created_at)=$2`,
      [year, parseInt(month) + 1]
    );

    // Current inventory snapshot
    const { rows: inventory } = await pool.query(
      "SELECT * FROM inventory ORDER BY stock, drug"
    );

    // Build CSV — DOH-3851 layout
    const headers = [
      "Record Type","Date","Time","Stock Location","Drug Name","Concentration",
      "Quantity","Unit","Supplier / Source","Supplier DEA #",
      "Manufacturer","Lot Number","Received / Transferred By","Witness",
      "From Stock","To Stock","Logged By"
    ];

    const allRows = [...purchases, ...transfers].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    const csvRows = allRows.map(r => {
      const d = new Date(r.created_at);
      return [
        r.record_type,
        d.toLocaleDateString("en-US"),
        d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        r.stock,
        r.drug,
        r.conc,
        r.qty,
        r.unit || "mL",
        r.supplier || r.from_stock || "",
        r.supplier_dea || "",
        r.manufacturer || "",
        r.lot || "",
        r.received_by || r.transferred_by || "",
        r.witness || "",
        r.from_stock || "",
        r.to_stock || "",
        r.logged_by,
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    });

    // Append current inventory snapshot at bottom
    csvRows.push(`""`);
    csvRows.push(`"CURRENT INVENTORY SNAPSHOT — as of ${new Date().toLocaleDateString("en-US")}"`);
    csvRows.push(["Stock","Drug","Concentration","Quantity","Unit","Manufacturer","Lot #","Supplier","Supplier DEA"].map(h=>`"${h}"`).join(","));
    for (const item of inventory) {
      csvRows.push([
        item.stock, item.drug, item.conc, item.qty, item.unit,
        item.manufacturer, item.lot, item.supplier, item.supplier_dea
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    }

    const monthName = ["January","February","March","April","May","June",
      "July","August","September","October","November","December"][parseInt(month)];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition",
      `attachment; filename="DOH-3851_${monthName}_${year}.csv"`);
    res.send([headers.map(h => `"${h}"`).join(","), ...csvRows].join("\r\n"));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full year export (both forms combined, all months)
app.get("/api/export/annual", auth, adminOnly, async (req, res) => {
  try {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: "year required" });

    const { rows: admins } = await pool.query(
      `SELECT * FROM administrations WHERE status='verified' AND EXTRACT(YEAR FROM created_at)=$1 ORDER BY created_at`,
      [year]
    );
    const { rows: purchases } = await pool.query(
      `SELECT * FROM purchases WHERE EXTRACT(YEAR FROM created_at)=$1 ORDER BY created_at`, [year]
    );
    const { rows: waste } = await pool.query(
      `SELECT * FROM waste WHERE EXTRACT(YEAR FROM created_at)=$1 ORDER BY created_at`, [year]
    );

    // Summary by drug
    const summary = {};
    for (const a of admins) {
      const k = `${a.drug}|${a.conc}`;
      if (!summary[k]) summary[k] = { drug: a.drug, conc: a.conc, administered: 0, purchased: 0, wasted: 0 };
      summary[k].administered += parseFloat(a.dose_qty || 0);
    }
    for (const p of purchases) {
      const k = `${p.drug}|${p.conc}`;
      if (!summary[k]) summary[k] = { drug: p.drug, conc: p.conc, administered: 0, purchased: 0, wasted: 0 };
      summary[k].purchased += parseFloat(p.qty || 0);
    }
    for (const w of waste) {
      const k = `${w.drug}|${w.conc}`;
      if (!summary[k]) summary[k] = { drug: w.drug, conc: w.conc, administered: 0, purchased: 0, wasted: 0 };
      summary[k].wasted += parseFloat(w.qty || 0);
    }

    const lines = [
      `"NARCOTRACK EMS — ANNUAL CONTROLLED SUBSTANCE REPORT"`,
      `"Year: ${year}"`,
      `"Generated: ${new Date().toLocaleString("en-US")}"`,
      `"NYS 10 NYCRR §80.136"`,
      `""`,
      `"ANNUAL DRUG SUMMARY"`,
      `"Drug","Concentration","Total Purchased","Total Administered","Total Wasted","Net Balance"`,
      ...Object.values(summary).map(s =>
        `"${s.drug}","${s.conc}","${s.purchased.toFixed(2)}","${s.administered.toFixed(2)}","${s.wasted.toFixed(2)}","${(s.purchased - s.administered - s.wasted).toFixed(2)}"`
      ),
      `""`,
      `"ADMINISTRATION RECORDS (${admins.length} verified)"`,
      `"Date","Drug","Dose","Route","Run ID","Patient","Provider","MD","Hospital","Verified By"`,
      ...admins.map(a => {
        const d = new Date(a.created_at);
        return `"${d.toLocaleDateString("en-US")}","${a.drug}","${a.dose}","${a.route}","${a.run_id}","${a.patient_name}","${a.provider_name}","${a.md_name}","${a.receiving_hospital}","${a.verified_by}"`;
      }),
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="NarcTrack_Annual_${year}.csv"`);
    res.send(lines.join("\r\n"));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`NarcTrack API running on port ${PORT}`));
