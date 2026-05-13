// ============================================================
// NarcTrack — Multi-Agency Backend API
// Node.js + Express + PostgreSQL + Google OAuth + JWT
// NYS 10 NYCRR §80.136 Compliant Recordkeeping
// ============================================================

require("dotenv").config();

// ─── Startup environment validation (Issue #14) ───────────────────────────────
function requireEnv(...vars) {
  const missing = vars.filter(v => !process.env[v]);
  if (missing.length) {
    console.error(`FATAL: Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}
requireEnv(
  "DATABASE_URL", "JWT_SECRET", "SESSION_SECRET",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "API_URL", "FRONTEND_URL"
);

const express    = require("express");
const { Pool }   = require("pg");
const bcrypt     = require("bcrypt");
const jwt        = require("jsonwebtoken");
const cors       = require("cors");
const passport   = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session    = require("express-session");
const rateLimit  = require("express-rate-limit");
const crypto     = require("crypto");

const app  = express();
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

    // 6. Drop old single-agency stock CHECK constraints
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

    // 8. Global role on users
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS global_role VARCHAR(20)`);

    // 9. Tab/icon config per agency
    await client.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS tab_config JSONB`);

    // 10. Seed sysadmin — Issue #2 fix: only insert if not present; never overwrite
    //     a previously-changed password on redeploy.
    const { rows: [existingSA] } = await client.query(
      "SELECT id FROM users WHERE username='sysadmin'"
    );
    if (!existingSA) {
      const initialPw = process.env.SYSADMIN_INITIAL_PASSWORD || "SysAdmin123!";
      const saHash = await bcrypt.hash(initialPw, 12);
      await client.query(`
        INSERT INTO users (username, password_hash, name, global_role)
        VALUES ('sysadmin', $1, 'System Administrator', 'sysadmin')
        ON CONFLICT (username) DO NOTHING
      `, [saHash]);
      if (!process.env.SYSADMIN_INITIAL_PASSWORD) {
        console.warn("SECURITY WARNING: SYSADMIN_INITIAL_PASSWORD not set. Using built-in default — change it immediately after first login.");
      }
    } else {
      // Ensure global_role is set even for pre-existing sysadmin rows
      await client.query(
        "UPDATE users SET global_role='sysadmin' WHERE username='sysadmin' AND global_role IS NULL"
      );
    }

    // 11. user_agencies junction table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_agencies (
        user_id   INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        agency_id INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
        role      VARCHAR(50) NOT NULL DEFAULT 'pending',
        badge     VARCHAR(50) NOT NULL DEFAULT 'UNASSIGNED',
        PRIMARY KEY (user_id, agency_id)
      )
    `);

    // 12. Seed user_agencies from existing users rows (idempotent)
    await client.query(`
      INSERT INTO user_agencies (user_id, agency_id, role, badge)
      SELECT id,
             agency_id,
             COALESCE(role,  'pending'),
             COALESCE(badge, 'UNASSIGNED')
      FROM   users
      WHERE  agency_id IS NOT NULL
      ON CONFLICT (user_id, agency_id) DO NOTHING
    `);

    // 13. OAuth exchange codes table — Issue #1: secure token handoff (no JWT in URL)
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
        code       TEXT PRIMARY KEY,
        token      TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
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

// Periodic cleanup of expired exchange codes
setInterval(async () => {
  try {
    await pool.query("DELETE FROM oauth_exchange_codes WHERE created_at < NOW() - INTERVAL '2 minutes'");
  } catch { /* non-fatal */ }
}, 60_000);

// ─── Rate limiters — Issue #7 ─────────────────────────────────────────────────
// Trust Railway's reverse proxy so X-Forwarded-For is used for real client IP
app.set("trust proxy", 1);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── CORS — Issue #6: restrict Vercel wildcard to configured prefixes ─────────
const allowedOrigin = (origin, callback) => {
  if (!origin) return callback(null, true); // server-to-server / curl
  const exact = process.env.FRONTEND_URL || "";
  if (origin === exact) return callback(null, true);
  if (origin.startsWith("http://localhost")) return callback(null, true);

  // Only allow Vercel preview URLs whose project name matches ALLOWED_VERCEL_PREFIXES
  const prefixes = (process.env.ALLOWED_VERCEL_PREFIXES || "narcotrack")
    .split(",").map(p => p.trim()).filter(Boolean);
  const isAllowedVercel = prefixes.some(prefix =>
    origin.startsWith(`https://${prefix}`) && origin.endsWith(".vercel.app")
  );
  if (isAllowedVercel) return callback(null, true);

  callback(new Error(`CORS: origin ${origin} not allowed`));
};

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" })); // reduced; avatar validated at the route level
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === "production", httpOnly: true, sameSite: "lax" },
}));
app.use(passport.initialize());
app.use(passport.session());

// General API rate limit
app.use("/api/", apiLimiter);
// Strict limits on auth endpoints — Issue #7
app.use("/api/login", authLimiter);
app.use("/api/auth/google", authLimiter);

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function issueToken(user, agency, membership) {
  return jwt.sign(
    {
      id: user.id, email: user.email,
      username: user.username || user.email,
      role:  membership.role,
      badge: membership.badge,
      name:  user.name,
      agency_id:      agency.id,
      agency_name:    agency.name,
      agency_slug:    agency.slug,
      agency_primary: agency.primary_color,
      agency_nav:     agency.nav_color,
      agency_accent:  agency.accent_color,
      agency_stocks:  agency.stocks,
      agency_tabs:    agency.tab_config || null,
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

function sysAdminOnly(req, res, next) {
  if (req.user.global_role !== "sysadmin")
    return res.status(403).json({ error: "System admin access required" });
  next();
}

function issueSysAdminToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username,
      name: user.name, role: "sysadmin", global_role: "sysadmin" },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  `${process.env.API_URL}/api/auth/google/callback`,
  passReqToCallback: true,
}, async (req, accessToken, refreshToken, profile, done) => {
  try {
    const email    = profile.emails[0].value;
    const agencyId = req.session.oauth_agency_id || 1;

    let { rows: [user] } = await pool.query(
      "SELECT * FROM users WHERE email=$1", [email]
    );

    if (!user) {
      const { rows: [newUser] } = await pool.query(
        `INSERT INTO users (email, name, google_id, username)
         VALUES ($1,$2,$3,$1) RETURNING *`,
        [email, profile.displayName, profile.id]
      );
      user = newUser;
    }

    await pool.query(
      `INSERT INTO user_agencies (user_id, agency_id, role, badge)
       VALUES ($1,$2,'pending','UNASSIGNED')
       ON CONFLICT (user_id, agency_id) DO NOTHING`,
      [user.id, agencyId]
    );

    user._selected_agency_id = agencyId;
    return done(null, user);
  } catch (err) { return done(err, null); }
}));

passport.serializeUser((user, done) =>
  done(null, { id: user.id, agency_id: user._selected_agency_id || 1 })
);
passport.deserializeUser(async ({ id, agency_id }, done) => {
  const { rows } = await pool.query(
    `SELECT u.*, ua.role, ua.badge,
            a.id AS ag_id, a.name AS ag_name, a.slug,
            a.primary_color, a.nav_color, a.accent_color, a.stocks
     FROM users u
     JOIN user_agencies ua ON ua.user_id = u.id AND ua.agency_id = $2
     JOIN agencies       a  ON a.id = $2
     WHERE u.id = $1`,
    [id, agency_id]
  );
  done(null, rows[0] || null);
});

app.get("/api/auth/google", (req, res, next) => {
  const agencyId = parseInt(req.query.agency_id);
  if (!isNaN(agencyId)) req.session.oauth_agency_id = agencyId;
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

// Issue #1 fix: redirect with a short-lived opaque exchange code, not the JWT
app.get("/api/auth/google/callback",
  passport.authenticate("google", { failureRedirect: `${process.env.FRONTEND_URL}/login?error=auth_failed` }),
  async (req, res) => {
    if (!req.user) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_user`);

    const agencyId = req.session.oauth_agency_id || 1;

    const { rows: [membership] } = await pool.query(
      "SELECT role, badge FROM user_agencies WHERE user_id=$1 AND agency_id=$2",
      [req.user.id, agencyId]
    );
    if (!membership || membership.role === "pending")
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=pending`);

    const { rows: [ag] } = await pool.query("SELECT * FROM agencies WHERE id=$1", [agencyId]);
    if (!ag) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_agency`);

    const token = issueToken(req.user, ag, membership);

    // Store token behind a one-time 60-second exchange code — no JWT in the URL
    const code = crypto.randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO oauth_exchange_codes (code, token) VALUES ($1, $2)",
      [code, token]
    );

    res.redirect(`${process.env.FRONTEND_URL}/auth-callback?code=${code}`);
  }
);

// One-time exchange: code → JWT (Issue #1)
app.post("/api/auth/exchange", authLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== "string")
      return res.status(400).json({ error: "Invalid exchange code" });

    const { rows: [row] } = await pool.query(
      `DELETE FROM oauth_exchange_codes
       WHERE code=$1 AND created_at > NOW() - INTERVAL '60 seconds'
       RETURNING token`,
      [code]
    );
    if (!row) return res.status(401).json({ error: "Invalid or expired exchange code" });

    res.json({ token: row.token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Public: list agencies ────────────────────────────────────────────────────
app.get("/api/agencies", cors({ origin: "*" }), async (req, res) => {
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

    const { rows: [user] } = await pool.query(
      "SELECT * FROM users WHERE username=$1 OR email=$1",
      [username.toLowerCase()]
    );
    if (!user)               return res.status(401).json({ error: "No account found with that username or email." });
    if (!user.password_hash) return res.status(401).json({ error: "This account uses Google Sign-In. Please use the Google button to log in." });
    if (!await bcrypt.compare(password, user.password_hash))
                             return res.status(401).json({ error: "Wrong password. Please try again." });

    if (user.global_role === "sysadmin")
      return res.json({ token: issueSysAdminToken(user), role: "sysadmin" });

    if (!agency_id) return res.status(400).json({ error: "Please select an agency." });

    const { rows: [membership] } = await pool.query(
      "SELECT role, badge FROM user_agencies WHERE user_id=$1 AND agency_id=$2",
      [user.id, agency_id]
    );
    if (!membership) return res.status(403).json({ error: "You don't have access to that agency. Contact an administrator." });
    if (membership.role === "pending") return res.status(403).json({ error: "Your account is pending role assignment. Contact an administrator." });

    const { rows: [agency] } = await pool.query("SELECT * FROM agencies WHERE id=$1", [agency_id]);
    if (!agency) return res.status(404).json({ error: "Agency not found" });

    res.json({ token: issueToken(user, agency, membership) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Token refresh
app.post("/api/auth/refresh", auth, async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT u.*, ua.role AS ua_role, ua.badge AS ua_badge,
              a.id AS ag_id, a.name AS ag_name, a.slug,
              a.primary_color, a.nav_color, a.accent_color, a.stocks, a.tab_config
       FROM users u
       JOIN user_agencies ua ON ua.user_id = u.id AND ua.agency_id = $2
       JOIN agencies       a  ON a.id = $2
       WHERE u.id = $1`,
      [req.user.id, req.user.agency_id]
    );
    if (!row) return res.status(404).json({ error: "User or membership not found" });
    const agency     = { id: row.ag_id, name: row.ag_name, slug: row.slug,
                         primary_color: row.primary_color, nav_color: row.nav_color,
                         accent_color: row.accent_color, stocks: row.stocks,
                         tab_config: row.tab_config };
    const membership = { role: row.ua_role, badge: row.ua_badge };
    res.json({ token: issueToken(row, agency, membership) });
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
    const { rows: [row] } = await pool.query(
      `SELECT u.id, u.username, u.email, u.name, u.avatar,
              ua.role, ua.badge,
              (u.password_hash IS NOT NULL) AS has_password
       FROM users u
       JOIN user_agencies ua ON ua.user_id = u.id AND ua.agency_id = $2
       WHERE u.id = $1`,
      [req.user.id, req.user.agency_id]
    );
    if (!row) return res.status(404).json({ error: "User not found" });
    res.json(row);
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

    // Avatar validation — Issue #10
    if (avatar !== undefined) {
      if (avatar !== null) {
        if (typeof avatar !== "string")
          return res.status(400).json({ error: "Invalid avatar format" });
        if (avatar.length > 200_000)
          return res.status(400).json({ error: "Avatar too large (max ~150 KB)" });
        if (!avatar.startsWith("data:image/"))
          return res.status(400).json({ error: "Avatar must be an image data-URI" });
      }
      params.push(avatar);
      updates.push(`avatar=$${params.length}`);
    }

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
      `SELECT u.id, u.username, u.email, u.name, u.avatar, u.created_at,
              ua.role, ua.badge
       FROM users u
       JOIN user_agencies ua ON ua.user_id = u.id AND ua.agency_id = $1
       ORDER BY u.name`,
      [req.user.agency_id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/users/lookup", auth, adminOnly, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "email required" });
    const { rows: [user] } = await pool.query(
      "SELECT id, username, email, name FROM users WHERE email=$1",
      [email.toLowerCase()]
    );
    if (!user) return res.status(404).json({ error: "No NarcTrack account with that email." });
    const { rows: [existing] } = await pool.query(
      "SELECT role FROM user_agencies WHERE user_id=$1 AND agency_id=$2",
      [user.id, req.user.agency_id]
    );
    res.json({ ...user, already_member: !!existing, existing_role: existing?.role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/users", auth, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { username, password, name, badge, role, email } = req.body;
    // Issue #11: enforce 8-char minimum consistently
    if (password && password.length < 8)
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    const hash = password ? await bcrypt.hash(password, 12) : null;

    const { rows: [user] } = await client.query(
      `INSERT INTO users (username, email, password_hash, name)
       VALUES ($1,$2,$3,$4) RETURNING id,username,email,name`,
      [username?.toLowerCase(), email?.toLowerCase()||null, hash, name]
    );

    await client.query(
      `INSERT INTO user_agencies (user_id, agency_id, role, badge)
       VALUES ($1,$2,$3,$4)`,
      [user.id, req.user.agency_id, role||"user", badge||"UNASSIGNED"]
    );

    await client.query("COMMIT");
    res.status(201).json({ ...user, role: role||"user", badge: badge||"UNASSIGNED" });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Username or email already exists" });
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.post("/api/users/add-existing", auth, adminOnly, async (req, res) => {
  try {
    const { user_id, role, badge } = req.body;
    if (!user_id) return res.status(400).json({ error: "user_id required" });
    const { rows: [user] } = await pool.query(
      "SELECT id, username, email, name FROM users WHERE id=$1", [user_id]
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    await pool.query(
      `INSERT INTO user_agencies (user_id, agency_id, role, badge)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, agency_id) DO UPDATE SET role=$3, badge=$4`,
      [user_id, req.user.agency_id, role||"user", badge||"UNASSIGNED"]
    );
    res.json({ ...user, role: role||"user", badge: badge||"UNASSIGNED" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Issue #3 fix: verify target user belongs to admin's agency before any global field update
app.patch("/api/users/:id", auth, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const uid = req.params.id;
    const { role, badge, name, username, email, new_password } = req.body;

    // Verify target user is a member of this admin's agency (cross-agency protection)
    const { rows: [memberCheck] } = await client.query(
      "SELECT 1 FROM user_agencies WHERE user_id=$1 AND agency_id=$2",
      [uid, req.user.agency_id]
    );
    if (!memberCheck) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "User not in this agency" });
    }

    if (role !== undefined || badge !== undefined) {
      const { rows: [ua] } = await client.query(
        `UPDATE user_agencies
         SET role  = COALESCE($1, role),
             badge = COALESCE($2, badge)
         WHERE user_id=$3 AND agency_id=$4
         RETURNING role, badge`,
        [role, badge, uid, req.user.agency_id]
      );
      if (!ua) { await client.query("ROLLBACK"); return res.status(404).json({ error: "User not in this agency" }); }
    }

    const userUpdates = []; const uParams = [];
    if (name)         { uParams.push(name);                              userUpdates.push(`name=$${uParams.length}`); }
    if (username)     { uParams.push(username.toLowerCase());            userUpdates.push(`username=$${uParams.length}`); }
    if (email)        { uParams.push(email.toLowerCase());               userUpdates.push(`email=$${uParams.length}`); }
    if (new_password) {
      // Issue #11: enforce 8-char minimum in admin reset path too
      if (new_password.length < 8) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      uParams.push(await bcrypt.hash(new_password, 12));
      userUpdates.push(`password_hash=$${uParams.length}`);
    }
    if (userUpdates.length) {
      uParams.push(uid);
      await client.query(`UPDATE users SET ${userUpdates.join(",")} WHERE id=$${uParams.length}`, uParams);
    }

    await client.query("COMMIT");

    const { rows: [merged] } = await pool.query(
      `SELECT u.id, u.username, u.email, u.name, u.avatar, ua.role, ua.badge
       FROM users u JOIN user_agencies ua ON ua.user_id=u.id AND ua.agency_id=$2
       WHERE u.id=$1`,
      [uid, req.user.agency_id]
    );
    res.json(merged);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Username or email already exists" });
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.delete("/api/users/:id", auth, adminOnly, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id)
      return res.status(400).json({ error: "Cannot remove yourself from the agency" });
    await pool.query(
      "DELETE FROM user_agencies WHERE user_id=$1 AND agency_id=$2",
      [req.params.id, req.user.agency_id]
    );
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
    const minQty = parseFloat(req.body.minQty);
    if (isNaN(minQty) || minQty < 0)
      return res.status(400).json({ error: "minQty must be a non-negative number" });
    const { rows } = await pool.query(
      "UPDATE inventory SET min_qty=$1 WHERE id=$2 AND agency_id=$3 RETURNING *",
      [minQty, req.params.id, req.user.agency_id]
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

app.post("/api/pending", auth, authLimiter, async (req, res) => {
  const d = req.body;

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
    const doseQty = parseFloat(d.doseQty);
    if (isNaN(doseQty) || doseQty <= 0)
      return res.status(400).json({ error: "Invalid dose quantity" });
    if (inv[0].qty < doseQty)
      return res.status(400).json({ error: "Insufficient inventory" });

    const { rows } = await client.query(
      `INSERT INTO pending_administrations
       (stock,drug,conc,dose,dose_qty,route,run_id,patient_name,complaint,
        provider_num,provider_name,md_name,md_sig,receiving_hospital,
        hospital_record_num,witness,waste_amt,waste_witness,waste_reason,logged_by,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [d.stock,d.drug,d.conc,d.dose,doseQty,d.route,d.runId,d.patientName,
       d.complaint,d.providerNum,d.providerName,d.mdName,d.mdSig,
       d.receivingHospital,d.hospitalRecordNum,d.witness,
       d.wasteAmt||0,d.wasteWitness||"",d.wasteReason||"",req.user.username,req.user.agency_id]
    );
    await client.query(
      "UPDATE inventory SET qty=qty-$1,updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4 AND agency_id=$5",
      [doseQty,d.stock,d.drug,d.conc,req.user.agency_id]
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

    if (year)  { params.push(year);             q += ` AND EXTRACT(YEAR  FROM created_at)=$${params.length}`; }
    if (month !== undefined && month !== "") {
      params.push(parseInt(month)+1);           q += ` AND EXTRACT(MONTH FROM created_at)=$${params.length}`;
    }
    if (stock)  { params.push(stock);           q += ` AND stock=$${params.length}`; }
    if (status) { params.push(status);          q += ` AND status=$${params.length}`; }
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
// Issue #12: added month filter so client doesn't have to fetch whole year
app.get("/api/purchases", auth, adminOnly, async (req, res) => {
  try {
    const { year, month } = req.query;
    let q = "SELECT * FROM purchases WHERE agency_id=$1";
    const params = [req.user.agency_id];
    if (year)  { params.push(year);             q += ` AND EXTRACT(YEAR  FROM created_at)=$${params.length}`; }
    if (month !== undefined && month !== "") {
      params.push(parseInt(month)+1);           q += ` AND EXTRACT(MONTH FROM created_at)=$${params.length}`;
    }
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
// Issue #12: added month filter
app.get("/api/transfers", auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    let q = "SELECT * FROM transfers WHERE agency_id=$1";
    const params = [req.user.agency_id];
    if (year)  { params.push(year);             q += ` AND EXTRACT(YEAR  FROM created_at)=$${params.length}`; }
    if (month !== undefined && month !== "") {
      params.push(parseInt(month)+1);           q += ` AND EXTRACT(MONTH FROM created_at)=$${params.length}`;
    }
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

    const qty = parseFloat(d.qty);
    if (isNaN(qty) || qty <= 0)
      return res.status(400).json({ error: "Invalid transfer quantity" });

    const { rows: fromInv } = await client.query(
      "SELECT qty FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3 AND agency_id=$4",
      [d.fromStock,d.drug,d.conc,req.user.agency_id]
    );
    if (!fromInv[0] || fromInv[0].qty < qty)
      return res.status(400).json({ error: "Insufficient inventory in source stock" });

    const { rows } = await client.query(
      `INSERT INTO transfers (from_stock,to_stock,drug,conc,unit,qty,transferred_by,witness,logged_by,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [d.fromStock,d.toStock,d.drug,d.conc,d.unit||"mL",qty,d.transferredBy,d.witness,req.user.username,req.user.agency_id]
    );
    await client.query(
      "UPDATE inventory SET qty=qty-$1,updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4 AND agency_id=$5",
      [qty,d.fromStock,d.drug,d.conc,req.user.agency_id]
    );
    const { rows: dest } = await client.query(
      "SELECT id FROM inventory WHERE stock=$1 AND drug=$2 AND conc=$3 AND agency_id=$4",
      [d.toStock,d.drug,d.conc,req.user.agency_id]
    );
    if (dest[0]) {
      await client.query("UPDATE inventory SET qty=qty+$1,updated_at=NOW() WHERE id=$2", [qty,dest[0].id]);
    } else {
      // Issue #17 fix: inherit min_qty from source stock instead of hardcoding 3
      await client.query(
        `INSERT INTO inventory (stock,drug,conc,unit,qty,min_qty,manufacturer,lot,supplier,supplier_dea,agency_id)
         SELECT $1,drug,conc,unit,$2,min_qty,manufacturer,lot,supplier,supplier_dea,$3
         FROM inventory WHERE stock=$4 AND drug=$5 AND conc=$6 AND agency_id=$3`,
        [d.toStock,qty,req.user.agency_id,d.fromStock,d.drug,d.conc]
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
// Issue #12: added month filter
app.get("/api/waste", auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    let q = "SELECT * FROM waste WHERE agency_id=$1";
    const params = [req.user.agency_id];
    if (year)  { params.push(year);             q += ` AND EXTRACT(YEAR  FROM created_at)=$${params.length}`; }
    if (month !== undefined && month !== "") {
      params.push(parseInt(month)+1);           q += ` AND EXTRACT(MONTH FROM created_at)=$${params.length}`;
    }
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

    const qty = parseFloat(d.qty);
    if (isNaN(qty) || qty <= 0)
      return res.status(400).json({ error: "Invalid waste quantity" });

    const { rows } = await client.query(
      `INSERT INTO waste (stock,drug,conc,unit,qty,reason,disposed_by,witness,method,logged_by,agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [d.stock,d.drug,d.conc,d.unit||"mL",qty,d.reason,d.disposedBy,d.witness,d.method,req.user.username,req.user.agency_id]
    );
    await client.query(
      "UPDATE inventory SET qty=GREATEST(0,qty-$1),updated_at=NOW() WHERE stock=$2 AND drug=$3 AND conc=$4 AND agency_id=$5",
      [qty,d.stock,d.drug,d.conc,req.user.agency_id]
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

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
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
    for (const a of admins)    { const k=`${a.drug}|${a.conc}`; if(!summary[k]) summary[k]={drug:a.drug,conc:a.conc,administered:0,purchased:0,wasted:0}; summary[k].administered+=parseFloat(a.dose_qty||0); }
    for (const p of purchases) { const k=`${p.drug}|${p.conc}`; if(!summary[k]) summary[k]={drug:p.drug,conc:p.conc,administered:0,purchased:0,wasted:0}; summary[k].purchased+=parseFloat(p.qty||0); }
    for (const w of waste)     { const k=`${w.drug}|${w.conc}`; if(!summary[k]) summary[k]={drug:w.drug,conc:w.conc,administered:0,purchased:0,wasted:0}; summary[k].wasted+=parseFloat(w.qty||0); }
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SYSTEM ADMIN ROUTES ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/sysadmin/agencies", auth, sysAdminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*,
             COUNT(DISTINCT ua.user_id)::int AS user_count,
             COUNT(DISTINCT CASE WHEN ua.role='admin' THEN ua.user_id END)::int AS admin_count
      FROM   agencies a
      LEFT JOIN user_agencies ua ON ua.agency_id = a.id
      GROUP BY a.id
      ORDER BY a.name
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/sysadmin/agencies", auth, sysAdminOnly, async (req, res) => {
  try {
    const { name, slug, primary_color, nav_color, accent_color, stocks } = req.body;
    if (!name || !slug) return res.status(400).json({ error: "name and slug are required" });
    const { rows: [ag] } = await pool.query(
      `INSERT INTO agencies (name, slug, primary_color, nav_color, accent_color, stocks)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, slug.toLowerCase().replace(/\s+/g,"-"),
       primary_color||"#3b82f6", nav_color||"#1e293b", accent_color||"#38bdf8",
       JSON.stringify(stocks||["Main Stock","Sub-Stock 1","Sub-Stock 2"])]
    );
    res.status(201).json(ag);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Agency name or slug already exists" });
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/sysadmin/agencies/:id", auth, sysAdminOnly, async (req, res) => {
  try {
    const { name, slug, primary_color, nav_color, accent_color, stocks, tab_config } = req.body;
    const { rows: [ag] } = await pool.query(
      `UPDATE agencies SET
         name          = COALESCE($1, name),
         slug          = COALESCE($2, slug),
         primary_color = COALESCE($3, primary_color),
         nav_color     = COALESCE($4, nav_color),
         accent_color  = COALESCE($5, accent_color),
         stocks        = COALESCE($6, stocks),
         tab_config    = COALESCE($7, tab_config)
       WHERE id = $8 RETURNING *`,
      [name, slug ? slug.toLowerCase().replace(/\s+/g,"-") : null,
       primary_color, nav_color, accent_color,
       stocks ? JSON.stringify(stocks) : null,
       tab_config ? JSON.stringify(tab_config) : null,
       req.params.id]
    );
    if (!ag) return res.status(404).json({ error: "Agency not found" });
    res.json(ag);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Agency name or slug already exists" });
    res.status(500).json({ error: err.message });
  }
});

// Issue #9 fix: check all FK-constrained tables before deleting an agency
app.delete("/api/sysadmin/agencies/:id", auth, sysAdminOnly, async (req, res) => {
  try {
    const id = req.params.id;
    const checks = [
      ["user_agencies",           "assigned users"],
      ["inventory",               "inventory records"],
      ["pending_administrations", "pending administration records"],
      ["administrations",         "administration records"],
      ["purchases",               "purchase records"],
      ["transfers",               "transfer records"],
      ["waste",                   "waste records"],
      ["audits",                  "audit records"],
      ["monthly_logs",            "monthly log entries"],
    ];
    for (const [table, label] of checks) {
      const { rows: [cnt] } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE agency_id=$1`, [id]
      );
      if (cnt.n > 0)
        return res.status(400).json({ error: `Cannot delete — agency has ${cnt.n} ${label}. Remove all records first.` });
    }
    await pool.query("DELETE FROM agencies WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/sysadmin/users", auth, sysAdminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.email, u.name, u.global_role, u.created_at,
             COALESCE(json_agg(
               json_build_object('agency_id', ua.agency_id, 'agency_name', a.name, 'role', ua.role, 'badge', ua.badge)
             ) FILTER (WHERE ua.agency_id IS NOT NULL), '[]') AS memberships
      FROM   users u
      LEFT JOIN user_agencies ua ON ua.user_id = u.id
      LEFT JOIN agencies      a  ON a.id = ua.agency_id
      GROUP BY u.id
      ORDER BY u.name
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/sysadmin/users/:id", auth, sysAdminOnly, async (req, res) => {
  try {
    const { global_role, password } = req.body;
    const updates = []; const params = [];
    if (global_role !== undefined) { params.push(global_role || null); updates.push(`global_role=$${params.length}`); }
    if (password) {
      if (password.length < 8)
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      params.push(await bcrypt.hash(password, 12));
      updates.push(`password_hash=$${params.length}`);
    }
    if (!updates.length) return res.json({ ok: true });
    params.push(req.params.id);
    const { rows: [u] } = await pool.query(
      `UPDATE users SET ${updates.join(",")} WHERE id=$${params.length} RETURNING id,username,email,name,global_role`,
      params
    );
    res.json(u);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/sysadmin/agencies/:agencyId/users", auth, sysAdminOnly, async (req, res) => {
  try {
    const { user_id, role, badge } = req.body;
    if (!user_id) return res.status(400).json({ error: "user_id is required" });
    const { rows: [u] } = await pool.query("SELECT id, name FROM users WHERE id=$1", [user_id]);
    if (!u) return res.status(404).json({ error: "User not found" });
    const { rows: [ag] } = await pool.query("SELECT id FROM agencies WHERE id=$1", [req.params.agencyId]);
    if (!ag) return res.status(404).json({ error: "Agency not found" });
    await pool.query(
      `INSERT INTO user_agencies (user_id, agency_id, role, badge)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, agency_id) DO UPDATE SET role=$3, badge=$4`,
      [user_id, req.params.agencyId, role || "user", badge || "UNASSIGNED"]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/sysadmin/agencies/:agencyId/users/:userId", auth, sysAdminOnly, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM user_agencies WHERE user_id=$1 AND agency_id=$2",
      [req.params.userId, req.params.agencyId]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`NarcTrack API running on port ${PORT}`));
