-- ============================================================
-- NarcTrack EMS — Database Setup
-- Run this in Supabase SQL Editor (or any PostgreSQL client)
-- NYS 10 NYCRR §80.136 Compliant Schema
-- ============================================================

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT,              -- NULL for Google-only accounts
  google_id     TEXT UNIQUE,
  name          TEXT NOT NULL,
  badge         TEXT NOT NULL DEFAULT 'UNASSIGNED',
  role          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (role IN ('admin','user','pending')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Inventory ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id           SERIAL PRIMARY KEY,
  stock        TEXT NOT NULL
                 CHECK (stock IN ('Main Stock','Sub-Stock 1','Sub-Stock 2')),
  drug         TEXT NOT NULL,
  conc         TEXT NOT NULL,
  unit         TEXT NOT NULL DEFAULT 'mL',
  qty          NUMERIC NOT NULL DEFAULT 0,
  min_qty      NUMERIC NOT NULL DEFAULT 5,
  manufacturer TEXT,
  lot          TEXT,
  supplier     TEXT,
  supplier_dea TEXT,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (stock, drug, conc)
);

-- ─── Pending Administrations (awaiting admin review) ──────────────────────────
CREATE TABLE IF NOT EXISTS pending_administrations (
  id                   SERIAL PRIMARY KEY,
  stock                TEXT NOT NULL,
  drug                 TEXT NOT NULL,
  conc                 TEXT NOT NULL,
  dose                 TEXT,
  dose_qty             NUMERIC NOT NULL DEFAULT 0,
  route                TEXT,
  run_id               TEXT NOT NULL,
  patient_name         TEXT NOT NULL,
  complaint            TEXT,
  provider_num         TEXT NOT NULL,
  provider_name        TEXT NOT NULL,
  md_name              TEXT NOT NULL,
  md_sig               TEXT,
  receiving_hospital   TEXT NOT NULL,
  hospital_record_num  TEXT,
  witness              TEXT NOT NULL,
  waste_amt            NUMERIC DEFAULT 0,
  waste_witness        TEXT,
  waste_reason         TEXT,
  logged_by            TEXT NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Administrations (verified + rejected) ────────────────────────────────────
-- §80.136(h)(3) — All required fields present
-- §80.136(j)    — 5-year retention enforced by never deleting
CREATE TABLE IF NOT EXISTS administrations (
  id                   SERIAL PRIMARY KEY,
  stock                TEXT NOT NULL,
  drug                 TEXT NOT NULL,
  conc                 TEXT NOT NULL,
  dose                 TEXT,
  dose_qty             NUMERIC NOT NULL DEFAULT 0,
  route                TEXT,
  run_id               TEXT NOT NULL,
  patient_name         TEXT NOT NULL,
  complaint            TEXT,
  provider_num         TEXT NOT NULL,
  provider_name        TEXT NOT NULL,
  md_name              TEXT NOT NULL,
  md_sig               TEXT,
  receiving_hospital   TEXT NOT NULL,
  hospital_record_num  TEXT,
  witness              TEXT NOT NULL,
  waste_amt            NUMERIC DEFAULT 0,
  waste_witness        TEXT,
  waste_reason         TEXT,
  status               TEXT NOT NULL DEFAULT 'verified'
                         CHECK (status IN ('verified','rejected')),
  logged_by            TEXT NOT NULL,
  verified_by          TEXT,
  verified_at          TIMESTAMPTZ,
  verify_note          TEXT,
  rejected_by          TEXT,
  rejected_at          TIMESTAMPTZ,
  reject_reason        TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Purchases ────────────────────────────────────────────────────────────────
-- §80.136(i)(2) — Purchase records filed by date received
CREATE TABLE IF NOT EXISTS purchases (
  id           SERIAL PRIMARY KEY,
  stock        TEXT NOT NULL,
  drug         TEXT NOT NULL,
  conc         TEXT NOT NULL,
  unit         TEXT DEFAULT 'mL',
  qty          NUMERIC NOT NULL,
  supplier     TEXT NOT NULL,
  supplier_dea TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  lot          TEXT NOT NULL,
  received_by  TEXT NOT NULL,
  logged_by    TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Transfers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers (
  id              SERIAL PRIMARY KEY,
  from_stock      TEXT NOT NULL,
  to_stock        TEXT NOT NULL,
  drug            TEXT NOT NULL,
  conc            TEXT NOT NULL,
  unit            TEXT DEFAULT 'mL',
  qty             NUMERIC NOT NULL,
  transferred_by  TEXT NOT NULL,
  witness         TEXT NOT NULL,
  logged_by       TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Waste ────────────────────────────────────────────────────────────────────
-- §80.136(h)(5) — Witnessed destruction
CREATE TABLE IF NOT EXISTS waste (
  id           SERIAL PRIMARY KEY,
  stock        TEXT NOT NULL,
  drug         TEXT NOT NULL,
  conc         TEXT NOT NULL,
  unit         TEXT DEFAULT 'mL',
  qty          NUMERIC NOT NULL,
  reason       TEXT NOT NULL,
  disposed_by  TEXT NOT NULL,
  witness      TEXT NOT NULL,
  method       TEXT NOT NULL,
  logged_by    TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Audits ───────────────────────────────────────────────────────────────────
-- §80.136(g)(4)(v) — Shift-change inventory
CREATE TABLE IF NOT EXISTS audits (
  id         SERIAL PRIMARY KEY,
  stock      TEXT NOT NULL,
  auditor    TEXT NOT NULL,
  witness    TEXT NOT NULL,
  results    JSONB NOT NULL,
  notes      TEXT,
  logged_by  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Monthly Logs ─────────────────────────────────────────────────────────────
-- §80.136(j) — Monthly review and retention documentation
CREATE TABLE IF NOT EXISTS monthly_logs (
  id              SERIAL PRIMARY KEY,
  year            INT NOT NULL,
  month           INT NOT NULL,           -- 0-indexed to match JS
  reviewed_by     TEXT,
  md_review       TEXT,
  discrepancies   TEXT,
  notes           TEXT,
  admin_count     INT DEFAULT 0,
  purchase_count  INT DEFAULT 0,
  transfer_count  INT DEFAULT 0,
  waste_count     INT DEFAULT 0,
  saved_by        TEXT,
  saved_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (year, month)
);

-- ─── Indexes for query performance ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_admin_created    ON administrations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_stock      ON administrations (stock);
CREATE INDEX IF NOT EXISTS idx_admin_status     ON administrations (status);
CREATE INDEX IF NOT EXISTS idx_admin_logged_by  ON administrations (logged_by);
CREATE INDEX IF NOT EXISTS idx_pending_created  ON pending_administrations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_date   ON purchases (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_date   ON transfers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waste_date       ON waste (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_stock  ON inventory (stock, drug, conc);
CREATE INDEX IF NOT EXISTS idx_monthly_year     ON monthly_logs (year, month);

-- ─── Seed data — initial inventory ────────────────────────────────────────────
INSERT INTO inventory (stock, drug, conc, unit, qty, min_qty, manufacturer, lot, supplier, supplier_dea) VALUES
  ('Main Stock', 'Morphine',    '10mg/mL',  'mL', 50, 10, 'Pfizer',    'PF-4421', 'AmerisourceBergen', 'BA0000001'),
  ('Main Stock', 'Fentanyl',    '50mcg/mL', 'mL', 20,  5, 'Hospira',   'HO-8810', 'AmerisourceBergen', 'BA0000001'),
  ('Main Stock', 'Lorazepam',   '2mg/mL',   'mL', 30,  8, 'Akorn',     'AK-1122', 'McKesson',          'BM0000002'),
  ('Main Stock', 'Midazolam',   '5mg/mL',   'mL', 25,  6, 'Fresenius', 'FR-3390', 'McKesson',          'BM0000002'),
  ('Main Stock', 'Naloxone',    '2mg/mL',   'mL', 40, 10, 'Amphastar', 'AM-5501', 'AmerisourceBergen', 'BA0000001'),
  ('Sub-Stock 1','Morphine',    '10mg/mL',  'mL', 10,  4, 'Pfizer',    'PF-4421', 'Main Stock',        ''),
  ('Sub-Stock 1','Fentanyl',    '50mcg/mL', 'mL',  5,  2, 'Hospira',   'HO-8810', 'Main Stock',        ''),
  ('Sub-Stock 1','Naloxone',    '2mg/mL',   'mL',  8,  4, 'Amphastar', 'AM-5501', 'Main Stock',        ''),
  ('Sub-Stock 2','Morphine',    '10mg/mL',  'mL',  8,  4, 'Pfizer',    'PF-4421', 'Main Stock',        ''),
  ('Sub-Stock 2','Lorazepam',   '2mg/mL',   'mL',  6,  3, 'Akorn',     'AK-1122', 'Main Stock',        ''),
  ('Sub-Stock 2','Naloxone',    '2mg/mL',   'mL',  6,  4, 'Amphastar', 'AM-5501', 'Main Stock',        '')
ON CONFLICT (stock, drug, conc) DO NOTHING;

-- ─── Seed admin user ──────────────────────────────────────────────────────────
-- Password: admin123 (CHANGE THIS IMMEDIATELY after first login)
-- bcrypt hash of "admin123" with 12 rounds:
INSERT INTO users (username, email, password_hash, name, badge, role) VALUES
  ('admin', 'admin@youragency.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGniZpp8bVlzB.9SZQNE3MxY3Uu',
   'Administrator', 'ADM-001', 'admin')
ON CONFLICT (username) DO NOTHING;

-- ─── Row Level Security (optional — Supabase recommended) ─────────────────────
-- These prevent direct database access without going through your API.
-- Uncomment if you want an extra layer of protection.
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE administrations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pending_administrations ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Service role only" ON users USING (false);
-- CREATE POLICY "Service role only" ON administrations USING (false);
