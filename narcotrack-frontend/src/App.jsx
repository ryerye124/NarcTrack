// NarcTrack EMS — Frontend
// React 18 + React Router v6, wired to the NarcTrack API
// NYS 10 NYCRR §80.136 Compliant

import React, { useState, useEffect, useCallback } from "react";
import {
  BrowserRouter, Routes, Route, Navigate,
  useNavigate, useLocation,
} from "react-router-dom";

// ─── Config ───────────────────────────────────────────────────────────────────
const API    = import.meta.env.VITE_API_URL || "http://localhost:3001";
const STOCKS = ["Main Stock", "929", "9299"]; // fallback when JWT has no agency_stocks
const getStocks = user =>
  (user?.agency_stocks?.length ? user.agency_stocks : STOCKS);
const ROUTES_LIST = ["IV", "IM", "IN", "SubQ", "PO", "SL"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ─── Token helpers ─────────────────────────────────────────────────────────────
const getToken  = () => sessionStorage.getItem("narcotrack_token");
const saveToken = t  => sessionStorage.setItem("narcotrack_token", t);
const clearToken = () => sessionStorage.removeItem("narcotrack_token");

function decodeJwt(t) {
  try { return JSON.parse(atob(t.split(".")[1])); }
  catch { return null; }
}

// ─── Authenticated fetch helper ───────────────────────────────────────────────
async function api(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// Download a CSV export — response is a file, not JSON
async function downloadExport(urlPath) {
  const token = getToken();
  const res = await fetch(`${API}${urlPath}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || "Export failed");
  }
  const cd       = res.headers.get("content-disposition") || "";
  const match    = cd.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : "export.csv";
  const blob     = await res.blob();
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  // App shell
  appShell:   { fontFamily: "'Inter','Segoe UI',sans-serif", display: "flex", height: "100vh", overflow: "hidden", background: "#f8fafc" },

  // Sidebar
  sidebar:      bg => ({ width: 232, minWidth: 232, background: bg || "#0f172a", display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }),
  sidebarTop:   { padding: "18px 16px 14px", borderBottom: "1px solid rgba(255,255,255,.07)" },
  sidebarLogo:  { display: "flex", alignItems: "center", gap: 9 },
  sidebarTitle: { fontSize: 14, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  sidebarSub:   { fontSize: 10, color: "#475569", marginTop: 3, letterSpacing: ".04em", textTransform: "uppercase" },
  sidebarNav:   { flex: 1, overflowY: "auto", padding: "6px 8px" },
  sidebarSec:   { fontSize: 9, fontWeight: 700, color: "#475569", letterSpacing: ".1em", textTransform: "uppercase", padding: "14px 8px 5px" },
  sidebarItem:  a => ({ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", cursor: "pointer", border: "none", width: "100%", textAlign: "left", background: a ? "rgba(59,130,246,.18)" : "transparent", color: a ? "#93c5fd" : "#94a3b8", fontWeight: a ? 600 : 400, fontSize: 13, borderRadius: 7, borderLeft: a ? "3px solid #3b82f6" : "3px solid transparent", marginBottom: 1, transition: "background .1s,color .1s" }),
  sidebarFoot:  { padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,.07)", display: "flex", alignItems: "center", gap: 10 },
  sidebarName:  { fontSize: 13, fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  sidebarRole:  r => ({ fontSize: 10, fontWeight: 700, color: r === "admin" ? "#818cf8" : "#38bdf8", textTransform: "uppercase", letterSpacing: ".06em" }),

  // Main content
  main:       { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" },
  page:       { padding: "26px 28px", maxWidth: 1080, margin: "0 auto", width: "100%", boxSizing: "border-box" },

  // Cards
  card:       { background: "#fff", borderRadius: 10, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04)", marginBottom: 18 },

  // Typography
  h2:         { margin: "0 0 20px", fontSize: 22, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" },
  h3:         { margin: "0 0 14px", fontSize: 15, fontWeight: 600, color: "#1e293b" },

  // Tables
  tbl:        { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th:         { background: "#f8fafc", padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #e2e8f0", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" },
  td:         { padding: "9px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", verticalAlign: "top" },

  // Forms
  form2:      { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  form3:      { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 },
  label:      { display: "flex", flexDirection: "column", gap: 5, fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em" },
  input:      { padding: "8px 11px", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 13, outline: "none", color: "#0f172a", background: "#fff" },
  select:     { padding: "8px 11px", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 13, background: "#fff", color: "#0f172a" },
  textarea:   { padding: "8px 11px", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 13, minHeight: 68, resize: "vertical", color: "#0f172a" },
  span2:      { gridColumn: "1 / -1" },

  // Buttons
  btn:        { padding: "7px 14px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500 },
  btnPrimary: { padding: "9px 20px", borderRadius: 7, border: "none", cursor: "pointer", background: "#3b82f6", color: "#fff", fontWeight: 600, fontSize: 13 },
  btnSuccess: { padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: "#22c55e", color: "#fff", fontSize: 12, fontWeight: 500 },
  btnDanger:  { padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: "#ef4444", color: "#fff", fontSize: 12, fontWeight: 500 },
  btnGray:    { padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: "#e2e8f0", color: "#475569", fontSize: 12, fontWeight: 500 },
  btnExport:  c => ({ padding: "9px 18px", borderRadius: 7, border: "none", cursor: "pointer", background: c || "#0ea5e9", color: "#fff", fontWeight: 600, fontSize: 13 }),

  // Layout helpers
  row:        { display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" },
  filterRow:  { display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "flex-end" },

  // Status
  errBox:     { background: "#fef2f2", color: "#dc2626", padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13, border: "1px solid #fecaca" },
  okBox:      { background: "#f0fdf4", color: "#166534", padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13, border: "1px solid #bbf7d0" },
  loading:    { padding: 48, textAlign: "center", color: "#94a3b8", fontSize: 14 },
  center:     { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontSize: 16, color: "#64748b" },
  pill:       ok => ({ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: ok ? "#dcfce7" : "#fee2e2", color: ok ? "#166534" : "#dc2626" }),
  roleBadge:  r  => ({ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: r === "admin" ? "#ede9fe" : r === "pending" ? "#fef3c7" : "#dbeafe", color: r === "admin" ? "#7c3aed" : r === "pending" ? "#b45309" : "#1d4ed8" }),
  statBox:    { background: "#f8fafc", borderRadius: 8, padding: 16, textAlign: "center" },
  statNum:    { fontSize: 30, fontWeight: 700, color: "#0f172a" },
  statLabel:  { fontSize: 11, color: "#64748b", marginTop: 3 },

  // Legacy — used by sysadmin shell only
  app:        { fontFamily: "'Inter','Segoe UI',sans-serif", minHeight: "100vh", background: "#f8fafc" },
  nav:        { background: "#1e293b", color: "#fff", padding: "0 20px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" },
  navTitle:   { fontWeight: 700, fontSize: 17, marginRight: 12, padding: "13px 0", whiteSpace: "nowrap" },
  navTab:     a => ({ padding: "13px 12px", cursor: "pointer", border: "none", background: "none", color: a ? "#38bdf8" : "#94a3b8", borderBottom: a ? "2px solid #38bdf8" : "2px solid transparent", fontWeight: a ? 600 : 400, fontSize: 13 }),
  navUser:    { marginLeft: "auto", fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 8, paddingLeft: 8 },
  logoutBtn:  { background: "#ef4444", border: "none", color: "#fff", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12 },

  // Login
  loginWrap:  { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" },
  loginCard:  { background: "#fff", borderRadius: 14, padding: 40, width: 380, boxShadow: "0 25px 60px rgba(0,0,0,.4)" },
  loginTitle: { margin: "0 0 4px", fontSize: 26, fontWeight: 700, color: "#1e293b", textAlign: "center" },
  loginSub:   { margin: "0 0 24px", fontSize: 11, color: "#64748b", textAlign: "center" },
  loginInput: { display: "block", width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, marginBottom: 10, boxSizing: "border-box", color: "#0f172a" },
  loginBtn:   { display: "block", width: "100%", padding: 12, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer", marginBottom: 10 },
  googleBtn:  { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: 11, border: "1.5px solid #e2e8f0", borderRadius: 8, background: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer", textDecoration: "none", color: "#334155", gap: 10, boxSizing: "border-box" },
  divider:    { textAlign: "center", color: "#94a3b8", margin: "14px 0", fontSize: 12 },
};

// ─── Auth Callback — /auth-callback ───────────────────────────────────────────
function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get("code");
    const error  = params.get("error");
    if (error === "pending") {
      navigate("/login?msg=" + encodeURIComponent("Account pending role assignment — contact an admin."));
      return;
    }
    if (error) {
      navigate("/login?msg=" + encodeURIComponent("Google sign-in failed. Try again."));
      return;
    }
    if (!code) {
      navigate("/login?msg=No+auth+code+received");
      return;
    }
    fetch(`${API}/api/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.error || "Exchange failed"))))
      .then(({ token }) => { saveToken(token); navigate("/"); })
      .catch(() => navigate("/login?msg=" + encodeURIComponent("Sign-in failed. Please try again.")));
  }, [navigate]);
  return <div style={S.center}>Completing sign-in…</div>;
}

// ─── Login Page — /login ──────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [form,     setForm    ] = useState({ username: "", password: "", agency_id: "" });
  const [agencies, setAgencies] = useState([]);
  const [agLoad,   setAgLoad  ] = useState(true);
  const [err,      setErr     ] = useState("");
  const [busy,     setBusy    ] = useState(false);
  const location = useLocation();

  // Load agency list on mount
  useEffect(() => {
    fetch(`${API}/api/agencies`)
      .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.error || `HTTP ${r.status}`))))
      .then(list => {
        setAgencies(list);
        if (list.length === 1) setForm(p => ({ ...p, agency_id: list[0].id }));
      })
      .catch(ex => setErr(`Could not load agency list: ${ex.message}`))
      .finally(() => setAgLoad(false));
  }, []);

  useEffect(() => {
    const msg = new URLSearchParams(location.search).get("msg");
    if (msg) setErr(msg);
  }, [location.search]);

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.agency_id) { setErr("Please select your agency."); return; }
    setBusy(true); setErr("");
    try {
      const res  = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, agency_id: parseInt(form.agency_id) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Login failed");
      saveToken(body.token);
      onLogin(decodeJwt(body.token));
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  const googleHref = form.agency_id
    ? `${API}/api/auth/google?agency_id=${form.agency_id}`
    : `${API}/api/auth/google`;

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <h1 style={S.loginTitle}>🚑 NarcTrack EMS</h1>
        <p style={S.loginSub}>NYS 10 NYCRR §80.136 Controlled Substance Management</p>
        {err && <div style={S.errBox}>{err}</div>}

        {/* Agency selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Select Your Agency
          </label>
          {agLoad ? (
            <div style={{ padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, color: "#94a3b8" }}>
              Loading agencies…
            </div>
          ) : (
            <select
              style={{ ...S.loginInput, marginBottom: 0, color: form.agency_id ? "#1e293b" : "#94a3b8", appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%2394a3b8' d='M1 1l5 5 5-5'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
              value={form.agency_id}
              onChange={f("agency_id")}
              required
            >
              <option value="">— Choose an agency —</option>
              {agencies.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>

        <form onSubmit={submit}>
          <input style={S.loginInput} placeholder="Username or email"
            value={form.username} onChange={f("username")} required autoFocus />
          <input style={S.loginInput} type="password" placeholder="Password"
            value={form.password} onChange={f("password")} required />
          <button style={S.loginBtn} type="submit" disabled={busy || agLoad}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <div style={S.divider}>— or —</div>
        <a
          href={googleHref}
          style={{ ...S.googleBtn, opacity: form.agency_id ? 1 : 0.5, pointerEvents: form.agency_id ? "auto" : "none" }}
          title={form.agency_id ? "" : "Select an agency first"}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
          Sign in with Google
        </a>
        {!form.agency_id && !agLoad && agencies.length > 0 && (
          <p style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
            Select an agency above to enable Google sign-in
          </p>
        )}
        <div style={{ textAlign: "center", marginTop: 20, paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
          <a href="/sysadmin" style={{ fontSize: 11, color: "#94a3b8", textDecoration: "none" }}>
            🛡️ System Administrator Login
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Client-side image resize (canvas → JPEG base64, max 200×200 px) ─────────
function resizeImage(file, maxPx = 200) {
  return new Promise((resolve, reject) => {
    const img    = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload  = e => {
      img.onerror = reject;
      img.onload  = () => {
        const scale  = Math.min(maxPx / img.width, maxPx / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── mg/mcg/g → mL calculator ────────────────────────────────────────────────
// concStr format: "10mg/mL", "0.4mg/mL", "500mcg/mL", "1g/mL", etc.
function calcML(doseAmount, doseUnit, concStr) {
  const m = String(concStr).trim().match(/^([\d.]+)\s*(mg|mcg|g)\s*\/\s*mL$/i);
  if (!m) return null;
  const concVal  = parseFloat(m[1]);
  const concUnit = m[2].toLowerCase();
  const amt      = parseFloat(doseAmount);
  if (!amt || !concVal) return null;
  const toMg = (v, u) => u === "mcg" ? v / 1000 : u === "g" ? v * 1000 : v;
  const ml = toMg(amt, doseUnit.toLowerCase()) / toMg(concVal, concUnit);
  return Math.round(ml * 10000) / 10000; // 4 decimal places
}

// ─── Inventory Tab ────────────────────────────────────────────────────────────
function InventoryTab({ user }) {
  const [inv,      setInv     ] = useState({});
  const [loading,  setLoading ] = useState(true);
  const [showAdd,  setShowAdd ] = useState(false);
  const [err,      setErr     ] = useState("");
  const [msg,      setMsg     ] = useState("");
  const stocks = getStocks(user);
  const [form, setForm] = useState({
    stock: stocks[0], drug: "", conc: "", unit: "mL", qty: "",
    minQty: 5, manufacturer: "", lot: "", supplier: "", supplierDEA: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try { setInv(await api("/api/inventory")); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function addDrug(e) {
    e.preventDefault();
    try {
      await api("/api/inventory", { method: "POST", body: JSON.stringify(form) });
      setMsg("Drug added to inventory."); setShowAdd(false);
      setForm({ stock: stocks[0], drug: "", conc: "", unit: "mL", qty: "", minQty: 5, manufacturer: "", lot: "", supplier: "", supplierDEA: "" });
      load();
    } catch (ex) { setErr(ex.message); }
  }

  if (loading) return <div style={S.loading}>Loading inventory…</div>;

  return (
    <div style={S.page}>
      <div style={{ ...S.row, justifyContent: "space-between" }}>
        <h2 style={S.h2}>Inventory</h2>
        {user.role === "admin" && (
          <button style={S.btnPrimary} onClick={() => setShowAdd(v => !v)}>+ Add Drug</button>
        )}
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}

      {showAdd && (
        <div style={S.card}>
          <h3 style={S.h3}>Add Drug to Inventory</h3>
          <form onSubmit={addDrug} style={S.form3}>
            <label style={S.label}>Stock
              <select style={S.select} value={form.stock} onChange={f("stock")} required>
                {stocks.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label style={S.label}>Drug Name<input style={S.input} value={form.drug} onChange={f("drug")} required /></label>
            <label style={S.label}>Concentration (e.g. 10mg/mL)<input style={S.input} value={form.conc} onChange={f("conc")} required /></label>
            <label style={S.label}>Unit<input style={S.input} value={form.unit} onChange={f("unit")} placeholder="mL" /></label>
            <label style={S.label}>Initial Qty<input style={S.input} type="number" min="0" step="0.01" value={form.qty} onChange={f("qty")} required /></label>
            <label style={S.label}>Min Qty Alert<input style={S.input} type="number" min="0" value={form.minQty} onChange={f("minQty")} /></label>
            <label style={S.label}>Manufacturer<input style={S.input} value={form.manufacturer} onChange={f("manufacturer")} /></label>
            <label style={S.label}>Lot #<input style={S.input} value={form.lot} onChange={f("lot")} /></label>
            <label style={S.label}>Supplier<input style={S.input} value={form.supplier} onChange={f("supplier")} /></label>
            <label style={S.label}>Supplier DEA #<input style={S.input} value={form.supplierDEA} onChange={f("supplierDEA")} /></label>
            <div style={{ ...S.span2, display: "flex", gap: 8, gridColumn: "1/-1" }}>
              <button style={S.btnPrimary} type="submit">Save</button>
              <button style={{ ...S.btn, background: "#e2e8f0", color: "#475569" }} type="button" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {stocks.map(stock => (
        <div key={stock} style={S.card}>
          <h3 style={S.h3}>{stock}</h3>
          {!inv[stock]?.length ? (
            <p style={{ color: "#94a3b8", fontSize: 13 }}>No drugs in this stock.</p>
          ) : (
            <table style={S.tbl}>
              <thead>
                <tr>
                  {["Drug","Concentration","Qty","Unit","Min Qty","Status","Manufacturer","Lot #","Supplier"].map(h =>
                    <th key={h} style={S.th}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {inv[stock].map(item => (
                  <tr key={item.id}>
                    <td style={S.td}><strong>{item.drug}</strong></td>
                    <td style={S.td}>{item.conc}</td>
                    <td style={S.td}><strong style={{ color: item.qty <= item.min_qty ? "#dc2626" : "#16a34a" }}>{item.qty}</strong></td>
                    <td style={S.td}>{item.unit}</td>
                    <td style={S.td}>{item.min_qty}</td>
                    <td style={S.td}>
                      <span style={S.pill(item.qty > item.min_qty)}>
                        {item.qty <= 0 ? "OUT" : item.qty <= item.min_qty ? "LOW" : "OK"}
                      </span>
                    </td>
                    <td style={S.td}>{item.manufacturer}</td>
                    <td style={S.td}>{item.lot}</td>
                    <td style={S.td}>{item.supplier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Log Administration Tab ───────────────────────────────────────────────────
function LogAdminTab({ user, onStockChange }) {
  const availStocks = user.role === "admin" ? getStocks(user) : getStocks(user).filter(s => s !== "Main Stock");
  const blank = () => ({
    stock: availStocks[0], drug: "", conc: "", unit: "",
    doseAmount: "", doseUnit: "mg",
    route: "IV", runId: "", patientName: "", complaint: "",
    providerNum: user.badge || "", providerName: user.name || "",
    mdName: "", mdSig: "", receivingHospital: "", hospitalRecordNum: "",
    witness: "", wasteAmt: "", wasteWitness: "", wasteReason: "",
    confirmPassword: "",
  });
  const [form,         setForm        ] = useState(blank);
  const [inv,          setInv         ] = useState({});
  const [err,          setErr         ] = useState("");
  const [msg,          setMsg         ] = useState("");
  const [busy,         setBusy        ] = useState(false);
  const [submitLowStock, setSubmitLowStock] = useState([]);

  useEffect(() => { api("/api/inventory").then(setInv).catch(() => {}); }, []);

  const stockDrugs = inv[form.stock] || [];

  // Live mL calculation
  const mlCalc = (form.doseAmount && form.conc)
    ? calcML(form.doseAmount, form.doseUnit, form.conc)
    : null;

  function onStockChange(e) {
    setForm(p => ({ ...p, stock: e.target.value, drug: "", conc: "", unit: "", doseAmount: "", doseUnit: "mg" }));
  }

  function onDrugChange(e) {
    const d = (inv[form.stock] || []).find(x => x.drug === e.target.value);
    setForm(p => ({ ...p, drug: e.target.value, conc: d?.conc || "", unit: d?.unit || "", doseAmount: "", doseUnit: "mg" }));
  }

  async function submit(e) {
    e.preventDefault();
    if (mlCalc === null) { setErr("Cannot calculate mL — check concentration format (e.g. 10mg/mL)."); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const result = await api("/api/pending", { method: "POST", body: JSON.stringify({
        ...form,
        dose:    `${form.doseAmount}${form.doseUnit}`,
        doseQty: String(mlCalc),
      })});
      setMsg("Administration submitted — pending admin verification.");
      setSubmitLowStock(result.low_stock || []);
      if (result.low_stock?.length) onStockChange?.();
      setForm(blank());
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  const readonlyStyle = { ...S.input, background: "#f1f5f9", color: "#64748b", cursor: "default" };
  const mlStyle = { ...S.input,
    background: mlCalc !== null ? "#dcfce7" : "#f1f5f9",
    color:      mlCalc !== null ? "#166534" : "#94a3b8",
    fontWeight: mlCalc !== null ? 700 : 400,
    cursor: "default",
  };

  return (
    <div style={S.page}>
      <h2 style={S.h2}>Log Drug Administration</h2>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}
      {submitLowStock.length > 0 && (
        <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6,
                      padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
          ⚠️ <strong>Stock attention needed:</strong>{" "}
          {submitLowStock.map(item =>
            `${item.stock} — ${item.drug} is now at ${item.qty} ${item.unit} (minimum: ${item.min_qty})`
          ).join("; ")}. An admin should initiate a restock transfer.
        </div>
      )}
      <div style={S.card}>
        <form onSubmit={submit} style={S.form3}>

          {/* ── Row 1: Stock / Drug / Concentration ── */}
          <label style={S.label}>Stock Location
            <select style={S.select} value={form.stock} onChange={onStockChange} required>
              {availStocks.map(s => <option key={s}>{s}</option>)}
            </select>
          </label>

          <label style={S.label}>Drug
            <select style={S.select} value={form.drug} onChange={onDrugChange} required>
              <option value="">Select drug…</option>
              {stockDrugs.map(d => <option key={d.id} value={d.drug}>{d.drug}</option>)}
            </select>
          </label>

          <label style={S.label}>Concentration (auto-filled)
            <input style={readonlyStyle} value={form.conc} readOnly placeholder="Select a drug first" />
          </label>

          {/* ── Row 2: Unit / Dose Amount+Unit / mL ── */}
          <label style={S.label}>Unit (auto-filled)
            <input style={readonlyStyle} value={form.unit} readOnly placeholder="Auto-filled" />
          </label>

          <label style={S.label}>Dose Administered
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...S.input, flex: 1 }}
                type="number" min="0.001" step="any"
                value={form.doseAmount}
                onChange={e => setForm(p => ({ ...p, doseAmount: e.target.value }))}
                placeholder="Enter amount"
                required
              />
              <select
                style={{ ...S.select, width: 72 }}
                value={form.doseUnit}
                onChange={e => setForm(p => ({ ...p, doseUnit: e.target.value }))}>
                <option value="mg">mg</option>
                <option value="mcg">mcg</option>
                <option value="g">g</option>
              </select>
            </div>
          </label>

          <label style={S.label}>Volume Withdrawn (auto-calculated mL)
            <input
              style={mlStyle}
              value={mlCalc !== null ? `${mlCalc} mL` : ""}
              readOnly
              placeholder="Enter dose + select drug first"
            />
          </label>

          {/* ── Remaining fields ── */}
          <label style={S.label}>Route
            <select style={S.select} value={form.route} onChange={e => setForm(p => ({ ...p, route: e.target.value }))} required>
              {ROUTES_LIST.map(r => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label style={S.label}>Run / Call ID<input style={S.input} value={form.runId} onChange={e => setForm(p => ({ ...p, runId: e.target.value }))} required /></label>
          <label style={S.label}>Patient Name<input style={S.input} value={form.patientName} onChange={e => setForm(p => ({ ...p, patientName: e.target.value }))} required /></label>
          <label style={S.label}>Chief Complaint<input style={S.input} value={form.complaint} onChange={e => setForm(p => ({ ...p, complaint: e.target.value }))} /></label>
          <label style={S.label}>Provider # (AEMT)<input style={S.input} value={form.providerNum} onChange={e => setForm(p => ({ ...p, providerNum: e.target.value }))} required /></label>
          <label style={S.label}>Provider Name<input style={S.input} value={form.providerName} onChange={e => setForm(p => ({ ...p, providerName: e.target.value }))} required /></label>
          <label style={S.label}>Ordering Physician<input style={S.input} value={form.mdName} onChange={e => setForm(p => ({ ...p, mdName: e.target.value }))} required /></label>
          <label style={S.label}>MD Authorization / Sig<input style={S.input} value={form.mdSig} onChange={e => setForm(p => ({ ...p, mdSig: e.target.value }))} /></label>
          <label style={S.label}>Receiving Hospital<input style={S.input} value={form.receivingHospital} onChange={e => setForm(p => ({ ...p, receivingHospital: e.target.value }))} required /></label>
          <label style={S.label}>Hospital Record #<input style={S.input} value={form.hospitalRecordNum} onChange={e => setForm(p => ({ ...p, hospitalRecordNum: e.target.value }))} /></label>
          <label style={S.label}>Witness<input style={S.input} value={form.witness} onChange={e => setForm(p => ({ ...p, witness: e.target.value }))} required /></label>
          <label style={S.label}>Waste Amount (mL)<input style={S.input} type="number" min="0" step="0.01" value={form.wasteAmt} onChange={e => setForm(p => ({ ...p, wasteAmt: e.target.value }))} /></label>
          <label style={S.label}>Waste Witness<input style={S.input} value={form.wasteWitness} onChange={e => setForm(p => ({ ...p, wasteWitness: e.target.value }))} /></label>
          <label style={S.label}>Waste Reason<input style={S.input} value={form.wasteReason} onChange={e => setForm(p => ({ ...p, wasteReason: e.target.value }))} /></label>

          {/* Password confirmation — required for non-admin users (§80.136 compliance) */}
          {user.role !== "admin" && (
            <label style={{ ...S.label, gridColumn: "1/-1",
              background: "#fef9c3", border: "1px solid #fde047",
              borderRadius: 6, padding: "12px 14px" }}>
              <span style={{ fontWeight: 600, color: "#854d0e" }}>
                🔐 Confirm Your Identity — Enter Your Password to Submit
              </span>
              <input
                style={{ ...S.input, marginTop: 6, border: "1px solid #fde047" }}
                type="password"
                value={form.confirmPassword}
                onChange={e => setForm(p => ({ ...p, confirmPassword: e.target.value }))}
                placeholder="Your NarcTrack password"
                autoComplete="current-password"
                required
              />
            </label>
          )}

          <div style={{ gridColumn: "1/-1", display: "flex", alignItems: "center", gap: 12 }}>
            <button style={S.btnPrimary} type="submit" disabled={busy || mlCalc === null}>
              {busy ? "Submitting…" : "Submit Administration Record"}
            </button>
            {mlCalc === null && form.doseAmount && form.conc && (
              <span style={{ fontSize: 12, color: "#dc2626" }}>
                ⚠ Concentration format not recognized — use e.g. "10mg/mL" or "500mcg/mL"
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Pending Verifications Tab (admin) ────────────────────────────────────────
function PendingTab({ onStockChange, user, onNavigate }) {
  const [records,       setRecords      ] = useState([]);
  const [loading,       setLoading      ] = useState(true);
  const [err,           setErr          ] = useState("");
  const [noteMap,       setNoteMap      ] = useState({});
  const [reasonMap,     setReasonMap    ] = useState({});
  const [restockTarget, setRestockTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRecords(await api("/api/pending")); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function verify(record) {
    try {
      await api(`/api/pending/${record.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ note: noteMap[record.id] || "" }),
      });
      onStockChange?.();
      load();
      setRestockTarget(record);
    } catch (ex) { setErr(ex.message); }
  }

  async function reject(id) {
    if (!reasonMap[id]) { setErr("Rejection reason required."); return; }
    try {
      await api(`/api/pending/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: reasonMap[id] }) });
      load();
    } catch (ex) { setErr(ex.message); }
  }

  if (loading) return <div style={S.loading}>Loading…</div>;

  return (
    <div style={S.page}>
      <h2 style={S.h2}>Pending Verifications ({records.length})</h2>
      {err && <div style={S.errBox}>{err}</div>}

      {restockTarget && (
        <RestockPanel
          record={restockTarget}
          user={user}
          onDone={() => { setRestockTarget(null); onStockChange?.(); }}
          onNavigate={onNavigate}
        />
      )}

      {records.length === 0 && !restockTarget && (
        <div style={S.card}><p style={{ color: "#64748b", margin: 0 }}>No pending records.</p></div>
      )}
      {records.map(r => (
        <div key={r.id} style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <span><strong>{r.drug}</strong> {r.conc} — {r.dose} ({r.dose_qty} mL) via {r.route} &nbsp;<span style={S.roleBadge("user")}>{r.stock}</span></span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{new Date(r.created_at).toLocaleString()}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, fontSize: 13, marginBottom: 12 }}>
            <div><strong>Run ID:</strong> {r.run_id}</div>
            <div><strong>Patient:</strong> {r.patient_name}</div>
            <div><strong>Complaint:</strong> {r.complaint}</div>
            <div><strong>Provider:</strong> {r.provider_name} #{r.provider_num}</div>
            <div><strong>MD:</strong> {r.md_name}</div>
            <div><strong>Hospital:</strong> {r.receiving_hospital}</div>
            <div><strong>Witness:</strong> {r.witness}</div>
            <div><strong>Waste:</strong> {r.waste_amt || 0} mL — {r.waste_witness || "—"}</div>
            <div><strong>Submitted by:</strong> {r.logged_by}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...S.input, flex: 1, minWidth: 160 }} placeholder="Verify note (optional)"
              value={noteMap[r.id] || ""} onChange={e => setNoteMap(p => ({ ...p, [r.id]: e.target.value }))} />
            <button style={S.btnSuccess} onClick={() => verify(r)}>✓ Verify</button>
            <input style={{ ...S.input, flex: 1, minWidth: 180 }} placeholder="Rejection reason (required)"
              value={reasonMap[r.id] || ""} onChange={e => setReasonMap(p => ({ ...p, [r.id]: e.target.value }))} />
            <button style={S.btnDanger} onClick={() => reject(r.id)}>✕ Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Restock Panel — shown after verifying a pending administration ────────────
function RestockPanel({ record, user, onDone, onNavigate }) {
  const [qty,           setQty          ] = useState(String(record.dose_qty || ""));
  const [transferredBy, setTransferredBy] = useState(user?.name || "");
  const [witness,       setWitness      ] = useState("");
  const [busy,          setBusy         ] = useState(false);
  const [err,           setErr          ] = useState("");
  const [done,          setDone         ] = useState(false);

  async function logTransfer(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("/api/transfers", {
        method: "POST",
        body: JSON.stringify({
          fromStock:     "Main Stock",
          toStock:       record.stock,
          drug:          record.drug,
          conc:          record.conc,
          unit:          "mL",
          qty:           parseFloat(qty),
          transferredBy,
          witness,
        }),
      });
      setDone(true);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div style={{ ...S.card, background: "#f0fdf4", border: "2px solid #86efac", marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#166534", marginBottom: 6 }}>
          ✓ Restock logged — {record.drug} {record.conc}, {qty} mL → {record.stock}
        </div>
        <div style={{ fontSize: 13, color: "#166534", marginBottom: 14 }}>
          Run {record.run_id} · {record.patient_name} · verified and restocked.
          Now generate the DOH-4004 for this drug in the Exports tab.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.btnPrimary} onClick={() => onNavigate?.("exports")}>
            Open DOH Exports → 4004
          </button>
          <button style={{ ...S.btnPrimary, background: "#64748b" }} onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...S.card, border: "2px solid #38bdf8", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#0369a1" }}>
            Restock Sub-Stock
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
            Verified: Run {record.run_id} · {record.patient_name} ·{" "}
            <strong>{record.drug} {record.conc}</strong>, {record.dose_qty} mL from{" "}
            <strong>{record.stock}</strong>
          </div>
        </div>
        <button onClick={onDone}
          style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>
          ✕
        </button>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      <form onSubmit={logTransfer}>
        <div style={S.form3}>
          <label style={S.label}>From
            <input style={{ ...S.input, background: "#f1f5f9", color: "#64748b" }} value="Main Stock" readOnly />
          </label>
          <label style={S.label}>To
            <input style={{ ...S.input, background: "#f1f5f9", color: "#64748b" }} value={record.stock} readOnly />
          </label>
          <label style={S.label}>Drug
            <input style={{ ...S.input, background: "#f1f5f9", color: "#64748b" }} value={`${record.drug} ${record.conc}`} readOnly />
          </label>
          <label style={S.label}>Qty to Transfer (mL)
            <input style={S.input} type="number" min="0.01" step="0.01"
              value={qty} onChange={e => setQty(e.target.value)} required />
          </label>
          <label style={S.label}>Transferred By
            <input style={S.input} value={transferredBy}
              onChange={e => setTransferredBy(e.target.value)} required />
          </label>
          <label style={S.label}>Witness
            <input style={S.input} value={witness} placeholder="Required"
              onChange={e => setWitness(e.target.value)} required />
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button style={S.btnPrimary} type="submit" disabled={busy}>
            {busy ? "Logging…" : "Log Restock Transfer"}
          </button>
          <button type="button" style={{ ...S.btnPrimary, background: "#64748b" }} onClick={onDone}>
            Skip
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Administration Log Tab ───────────────────────────────────────────────────
// ─── Inspect Modal — single record full detail + per-record DOH export ────────
function InspectModal({ record, type, onClose }) {
  if (!record) return null;

  function Field({ label, value }) {
    if (!value && value !== 0) return null;
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 14, color: "#1e293b" }}>{value}</div>
      </div>
    );
  }

  const d = new Date(record.created_at);
  const dateStr = d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 700,
                    maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #e2e8f0",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      background: type === "admin" ? "#f0f9ff" : type === "purchase" ? "#f5f3ff" : "#f0fdf4" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>
              {type === "admin" ? "Administration Record" : type === "purchase" ? "Purchase Record" : "Transfer Record"}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b", marginTop: 2 }}>
              {type === "admin"    ? `${record.drug} ${record.conc} — ${record.patient_name}` : null}
              {type === "purchase" ? `${record.drug} ${record.conc} — ${record.supplier}` : null}
              {type === "transfer" ? `${record.drug} ${record.conc} — ${record.from_stock} → ${record.to_stock}` : null}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{dateStr} at {timeStr}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22,
                  cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px" }}>
          {type === "admin" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              <Field label="Stock Location"    value={record.stock} />
              <Field label="Run / Call ID"     value={record.run_id} />
              <Field label="Drug"              value={`${record.drug} ${record.conc}`} />
              <Field label="Dose Administered" value={record.dose} />
              <Field label="Volume Withdrawn"  value={`${record.dose_qty} mL`} />
              <Field label="Route"             value={record.route} />
              <Field label="Patient Name"      value={record.patient_name} />
              <Field label="Chief Complaint"   value={record.complaint} />
              <Field label="Provider Name"     value={record.provider_name} />
              <Field label="Provider #"        value={record.provider_num} />
              <Field label="Ordering Physician"value={record.md_name} />
              <Field label="MD Authorization"  value={record.md_sig} />
              <Field label="Receiving Hospital"value={record.receiving_hospital} />
              <Field label="Hospital Record #" value={record.hospital_record_num} />
              <Field label="Witness"           value={record.witness} />
              <Field label="Waste Amount"      value={record.waste_amt ? `${record.waste_amt} mL` : null} />
              <Field label="Waste Witness"     value={record.waste_witness} />
              <Field label="Waste Reason"      value={record.waste_reason} />
              <div style={{ gridColumn: "1/-1", borderTop: "1px solid #f1f5f9", paddingTop: 10, marginTop: 4 }} />
              <Field label="Submitted By"      value={record.logged_by} />
              <Field label="Status"            value={record.status?.toUpperCase()} />
              <Field label="Verified By"       value={record.verified_by} />
              <Field label="Date Verified"     value={record.verified_at ? new Date(record.verified_at).toLocaleDateString("en-US") : null} />
              <Field label="Verify Note"       value={record.verify_note} />
            </div>
          )}
          {type === "purchase" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              <Field label="Stock"          value={record.stock} />
              <Field label="Drug"           value={`${record.drug} ${record.conc}`} />
              <Field label="Quantity"       value={`${record.qty} ${record.unit}`} />
              <Field label="Supplier"       value={record.supplier} />
              <Field label="Supplier DEA #" value={record.supplier_dea} />
              <Field label="Manufacturer"   value={record.manufacturer} />
              <Field label="Lot #"          value={record.lot} />
              <Field label="Received By"    value={record.received_by} />
              <Field label="Logged By"      value={record.logged_by} />
            </div>
          )}
          {type === "transfer" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              <Field label="From Stock"      value={record.from_stock} />
              <Field label="To Stock"        value={record.to_stock} />
              <Field label="Drug"            value={`${record.drug} ${record.conc}`} />
              <Field label="Quantity"        value={`${record.qty} ${record.unit}`} />
              <Field label="Transferred By"  value={record.transferred_by} />
              <Field label="Witness"         value={record.witness} />
              <Field label="Logged By"       value={record.logged_by} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #e2e8f0",
                      display: "flex", gap: 10, justifyContent: "flex-end",
                      background: "#f8fafc" }}>
          <span style={{ fontSize: 12, color: "#94a3b8", alignSelf: "center", marginRight: "auto" }}>
            Use the DOH Exports tab to generate form CSVs.
          </span>
          <button onClick={onClose}
            style={{ padding: "8px 18px", borderRadius: 6, border: "1px solid #cbd5e1",
                     background: "#fff", color: "#475569", cursor: "pointer", fontSize: 13 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminLogTab({ user }) {
  const now = new Date();
  const [records,  setRecords ] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [err,      setErr     ] = useState("");
  const [filters,  setFilters ] = useState({ year: String(now.getFullYear()), month: String(now.getMonth()), stock: "", status: "" });
  const [inspectR, setInspectR] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.year)   p.set("year",   filters.year);
      if (filters.month !== "") p.set("month", filters.month);
      if (filters.stock)  p.set("stock",  filters.stock);
      if (filters.status) p.set("status", filters.status);
      setRecords(await api("/api/administrations?" + p));
    } catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const ff = k => e => setFilters(p => ({ ...p, [k]: e.target.value }));

  const rowHover = { cursor: "pointer" };

  return (
    <div style={S.page}>
      <InspectModal record={inspectR} type="admin" onClose={() => setInspectR(null)} />
      <h2 style={S.h2}>Administration Log</h2>
      {err && <div style={S.errBox}>{err}</div>}
      <div style={S.filterRow}>
        <label style={S.label}>Year<input style={{ ...S.input, width: 80 }} value={filters.year} onChange={ff("year")} /></label>
        <label style={S.label}>Month
          <select style={S.select} value={filters.month} onChange={ff("month")}>
            <option value="">All</option>
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
        </label>
        {user.role === "admin" && (
          <label style={S.label}>Stock
            <select style={S.select} value={filters.stock} onChange={ff("stock")}>
              <option value="">All</option>
              {getStocks(user).map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
        )}
        <label style={S.label}>Status
          <select style={S.select} value={filters.status} onChange={ff("status")}>
            <option value="">All</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <button style={{ ...S.btnPrimary, alignSelf: "flex-end" }} onClick={load}>Refresh</button>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", margin: "-4px 0 8px" }}>Click any row to inspect it. Generate DOH exports from the DOH Exports tab.</p>
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead>
              <tr>{["Date","Drug","Dose","Route","Run ID","Patient","Provider","MD","Hospital","Status","By"].map(h =>
                <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && <tr><td colSpan={11} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No records found.</td></tr>}
              {records.map(r => (
                <tr key={r.id} style={rowHover}
                  onClick={() => setInspectR(r)}
                  onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <td style={S.td}>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={S.td}>{r.drug} {r.conc}</td>
                  <td style={S.td}>{r.dose} ({r.dose_qty}mL)</td>
                  <td style={S.td}>{r.route}</td>
                  <td style={S.td}>{r.run_id}</td>
                  <td style={S.td}>{r.patient_name}</td>
                  <td style={S.td}>{r.provider_name}</td>
                  <td style={S.td}>{r.md_name}</td>
                  <td style={S.td}>{r.receiving_hospital}</td>
                  <td style={S.td}><span style={S.pill(r.status === "verified")}>{r.status.toUpperCase()}</span></td>
                  <td style={S.td}>{r.logged_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Purchases Tab (admin) ────────────────────────────────────────────────────
function PurchasesTab({ user }) {
  const now  = new Date();
  const blank = () => ({ stock: getStocks(user)[0], drug: "", conc: "", unit: "mL", qty: "", supplier: "", supplierDEA: "", manufacturer: "", lot: "", receivedBy: "" });
  const [records,  setRecords ] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm    ] = useState(blank());
  const [err,      setErr     ] = useState("");
  const [msg,      setMsg     ] = useState("");
  const [year,     setYear    ] = useState(String(now.getFullYear()));
  const [inspectR, setInspectR] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRecords(await api(`/api/purchases?year=${year}`)); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      await api("/api/purchases", { method: "POST", body: JSON.stringify(form) });
      setMsg("Purchase recorded and inventory updated."); setShowForm(false); setForm(blank()); load();
    } catch (ex) { setErr(ex.message); }
  }

  return (
    <div style={S.page}>
      <InspectModal record={inspectR} type="purchase" onClose={() => setInspectR(null)} />
      <div style={{ ...S.row, justifyContent: "space-between" }}>
        <h2 style={S.h2}>Purchases</h2>
        <button style={S.btnPrimary} onClick={() => setShowForm(v => !v)}>+ Log Purchase</button>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}
      <div style={S.filterRow}>
        <label style={S.label}>Year<input style={{ ...S.input, width: 80 }} value={year} onChange={e => setYear(e.target.value)} /></label>
        <button style={{ ...S.btnPrimary, alignSelf: "flex-end" }} onClick={load}>Filter</button>
      </div>
      {showForm && (
        <div style={S.card}>
          <h3 style={S.h3}>Log Purchase</h3>
          <form onSubmit={submit} style={S.form3}>
            <label style={S.label}>Stock<select style={S.select} value={form.stock} onChange={f("stock")} required>{getStocks(user).map(s=><option key={s}>{s}</option>)}</select></label>
            <label style={S.label}>Drug<input style={S.input} value={form.drug} onChange={f("drug")} required /></label>
            <label style={S.label}>Concentration<input style={S.input} value={form.conc} onChange={f("conc")} required /></label>
            <label style={S.label}>Unit<input style={S.input} value={form.unit} onChange={f("unit")} /></label>
            <label style={S.label}>Quantity<input style={S.input} type="number" min="0.01" step="0.01" value={form.qty} onChange={f("qty")} required /></label>
            <label style={S.label}>Supplier<input style={S.input} value={form.supplier} onChange={f("supplier")} required /></label>
            <label style={S.label}>Supplier DEA #<input style={S.input} value={form.supplierDEA} onChange={f("supplierDEA")} required /></label>
            <label style={S.label}>Manufacturer<input style={S.input} value={form.manufacturer} onChange={f("manufacturer")} required /></label>
            <label style={S.label}>Lot #<input style={S.input} value={form.lot} onChange={f("lot")} required /></label>
            <label style={S.label}>Received By<input style={S.input} value={form.receivedBy} onChange={f("receivedBy")} required /></label>
            <div style={{ gridColumn: "1/-1" }}><button style={S.btnPrimary} type="submit">Save Purchase</button></div>
          </form>
        </div>
      )}
      <p style={{ fontSize: 12, color: "#94a3b8", margin: "-4px 0 8px" }}>Click any row to inspect it. Generate DOH exports from the DOH Exports tab.</p>
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead><tr>{["Date","Stock","Drug","Conc","Qty","Supplier","DEA #","Manufacturer","Lot","Received By","By"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {records.length === 0 && <tr><td colSpan={11} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No purchases.</td></tr>}
              {records.map(r => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setInspectR(r)}
                  onMouseEnter={e => e.currentTarget.style.background = "#f5f3ff"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <td style={S.td}>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={S.td}>{r.stock}</td>
                  <td style={S.td}>{r.drug}</td>
                  <td style={S.td}>{r.conc}</td>
                  <td style={S.td}>{r.qty} {r.unit}</td>
                  <td style={S.td}>{r.supplier}</td>
                  <td style={S.td}>{r.supplier_dea}</td>
                  <td style={S.td}>{r.manufacturer}</td>
                  <td style={S.td}>{r.lot}</td>
                  <td style={S.td}>{r.received_by}</td>
                  <td style={S.td}>{r.logged_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Transfers Tab ────────────────────────────────────────────────────────────
function TransfersTab({ user }) {
  const now = new Date();
  // BUG-006 fix: availStocks defined BEFORE blank() so blank() can reference it safely
  // BUG-001 fix: role-aware defaults — non-admin never gets "Main Stock" as fromStock
  const availStocks = user.role === "admin" ? getStocks(user) : getStocks(user).filter(s => s !== "Main Stock");
  const blank = () => ({
    fromStock:    availStocks[0],
    toStock:      availStocks[1] ?? availStocks[0],
    drug: "", conc: "", unit: "", qty: "",
    transferredBy: user.name || "", witness: "",
  });

  const [records,  setRecords ] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm    ] = useState(blank());
  const [inv,      setInv     ] = useState({});
  const [err,      setErr     ] = useState("");
  const [msg,      setMsg     ] = useState("");
  const [year,     setYear    ] = useState(String(now.getFullYear()));
  const [inspectR, setInspectR] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, i] = await Promise.all([api(`/api/transfers?year=${year}`), api("/api/inventory")]);
      setRecords(r); setInv(i);
    } catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const fromDrugs = inv[form.fromStock] || [];

  // BUG-002 + BUG-003 fix: clear drug/conc/unit AND correct toStock when fromStock changes
  function onFromStockChange(e) {
    const newFrom = e.target.value;
    const validTo = availStocks.find(s => s !== newFrom) ?? availStocks[0];
    setForm(p => ({
      ...p,
      fromStock: newFrom,
      toStock:   p.toStock === newFrom ? validTo : p.toStock,
      drug: "", conc: "", unit: "",
    }));
  }

  async function submit(e) {
    e.preventDefault();
    try {
      await api("/api/transfers", { method: "POST", body: JSON.stringify(form) });
      setMsg("Transfer recorded."); setShowForm(false); setForm(blank()); load();
    } catch (ex) { setErr(ex.message); }
  }

  return (
    <div style={S.page}>
      <InspectModal record={inspectR} type="transfer" onClose={() => setInspectR(null)} />
      <div style={{ ...S.row, justifyContent: "space-between" }}>
        <h2 style={S.h2}>Transfers</h2>
        <button style={S.btnPrimary} onClick={() => setShowForm(v => !v)}>+ Log Transfer</button>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}
      <div style={S.filterRow}>
        <label style={S.label}>Year<input style={{ ...S.input, width: 80 }} value={year} onChange={e => setYear(e.target.value)} /></label>
        <button style={{ ...S.btnPrimary, alignSelf: "flex-end" }} onClick={load}>Filter</button>
      </div>
      {showForm && (
        <div style={S.card}>
          <h3 style={S.h3}>Log Transfer</h3>
          <form onSubmit={submit} style={S.form3}>
            {/* BUG-001/002/003 fix: use onFromStockChange instead of f("fromStock") */}
            <label style={S.label}>From Stock
              <select style={S.select} value={form.fromStock} onChange={onFromStockChange} required>
                {availStocks.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label style={S.label}>To Stock
              <select style={S.select} value={form.toStock} onChange={f("toStock")} required>
                {availStocks.filter(s => s !== form.fromStock).map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label style={S.label}>Drug
              {fromDrugs.length > 0 ? (
                <select style={S.select} value={form.drug} onChange={e => {
                  const d = fromDrugs.find(x => x.drug === e.target.value);
                  setForm(p => ({ ...p, drug: e.target.value, conc: d?.conc || "", unit: d?.unit || "" }));
                }} required>
                  <option value="">Select…</option>
                  {fromDrugs.map(d => <option key={d.id} value={d.drug}>{d.drug} ({d.qty} {d.unit} avail.)</option>)}
                </select>
              ) : <input style={S.input} value={form.drug} onChange={f("drug")} placeholder="No drugs in this stock" required />}
            </label>
            <label style={S.label}>Concentration
              <input style={{ ...S.input, background: "#f1f5f9", color: "#64748b" }} value={form.conc} readOnly placeholder="Auto-filled when drug selected" />
            </label>
            <label style={S.label}>Unit
              <input style={{ ...S.input, background: "#f1f5f9", color: "#64748b" }} value={form.unit} readOnly placeholder="Auto-filled" />
            </label>
            <label style={S.label}>Quantity<input style={S.input} type="number" min="0.01" step="0.01" value={form.qty} onChange={f("qty")} required /></label>
            <label style={S.label}>Transferred By<input style={S.input} value={form.transferredBy} onChange={f("transferredBy")} required /></label>
            <label style={S.label}>Witness<input style={S.input} value={form.witness} onChange={f("witness")} required /></label>
            <div style={{ gridColumn: "1/-1" }}><button style={S.btnPrimary} type="submit">Save Transfer</button></div>
          </form>
        </div>
      )}
      <p style={{ fontSize: 12, color: "#94a3b8", margin: "-4px 0 8px" }}>Click any row to inspect it. Generate DOH exports from the DOH Exports tab.</p>
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead><tr>{["Date","From","To","Drug","Conc","Qty","Transferred By","Witness","By"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {records.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No transfers.</td></tr>}
              {records.map(r => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setInspectR(r)}
                  onMouseEnter={e => e.currentTarget.style.background = "#f0fdf4"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <td style={S.td}>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={S.td}>{r.from_stock}</td>
                  <td style={S.td}>{r.to_stock}</td>
                  <td style={S.td}>{r.drug}</td>
                  <td style={S.td}>{r.conc}</td>
                  <td style={S.td}>{r.qty} {r.unit}</td>
                  <td style={S.td}>{r.transferred_by}</td>
                  <td style={S.td}>{r.witness}</td>
                  <td style={S.td}>{r.logged_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Waste Tab ────────────────────────────────────────────────────────────────
function WasteTab({ user }) {
  const now  = new Date();
  const availStocks = user.role === "admin" ? getStocks(user) : getStocks(user).filter(s => s !== "Main Stock");
  const blank = () => ({ stock: availStocks[0], drug: "", conc: "", unit: "", qty: "", reason: "", disposedBy: user.name || "", witness: "", method: "Inactivation Kit" });
  const [records,  setRecords ] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm    ] = useState(blank());
  const [inv,      setInv     ] = useState({});
  const [err,      setErr     ] = useState("");
  const [msg,      setMsg     ] = useState("");
  const [year,     setYear    ] = useState(String(now.getFullYear()));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, i] = await Promise.all([api(`/api/waste?year=${year}`), api("/api/inventory")]);
      setRecords(r); setInv(i);
    } catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const stockDrugs  = inv[form.stock] || [];

  async function submit(e) {
    e.preventDefault();
    try {
      await api("/api/waste", { method: "POST", body: JSON.stringify(form) });
      setMsg("Waste record logged."); setShowForm(false); setForm(blank()); load();
    } catch (ex) { setErr(ex.message); }
  }

  return (
    <div style={S.page}>
      <div style={{ ...S.row, justifyContent: "space-between" }}>
        <h2 style={S.h2}>Waste Records</h2>
        <button style={S.btnPrimary} onClick={() => setShowForm(v => !v)}>+ Log Waste</button>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}
      <div style={S.filterRow}>
        <label style={S.label}>Year<input style={{ ...S.input, width: 80 }} value={year} onChange={e => setYear(e.target.value)} /></label>
        <button style={{ ...S.btnPrimary, alignSelf: "flex-end" }} onClick={load}>Filter</button>
      </div>
      {showForm && (
        <div style={S.card}>
          <h3 style={S.h3}>Log Waste / Destruction</h3>
          <form onSubmit={submit} style={S.form3}>
            {/* BUG-005 fix: stock onChange clears drug/conc/unit to prevent stale values */}
            <label style={S.label}>Stock
              <select style={S.select} value={form.stock} onChange={e => setForm(p => ({ ...p, stock: e.target.value, drug: "", conc: "", unit: "" }))} required>
                {availStocks.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label style={S.label}>Drug
              {stockDrugs.length > 0 ? (
                <select style={S.select} value={form.drug} onChange={e => {
                  const d = stockDrugs.find(x => x.drug === e.target.value);
                  setForm(p => ({ ...p, drug: e.target.value, conc: d?.conc || "", unit: d?.unit || "" }));
                }} required>
                  <option value="">Select…</option>
                  {stockDrugs.map(d => <option key={d.id} value={d.drug}>{d.drug}</option>)}
                </select>
              ) : <input style={S.input} value={form.drug} onChange={f("drug")} required />}
            </label>
            <label style={S.label}>Concentration
              <input style={{ ...S.input, background: "#f1f5f9", color: "#64748b" }} value={form.conc} readOnly placeholder="Auto-filled when drug selected" />
            </label>
            <label style={S.label}>Unit
              <input style={{ ...S.input, background: "#f1f5f9", color: "#64748b" }} value={form.unit} readOnly placeholder="Auto-filled" />
            </label>
            <label style={S.label}>Quantity<input style={S.input} type="number" min="0.01" step="0.01" value={form.qty} onChange={f("qty")} required /></label>
            <label style={S.label}>Reason<input style={S.input} value={form.reason} onChange={f("reason")} required /></label>
            <label style={S.label}>Disposed By<input style={S.input} value={form.disposedBy} onChange={f("disposedBy")} required /></label>
            <label style={S.label}>Witness<input style={S.input} value={form.witness} onChange={f("witness")} required /></label>
            <label style={S.label}>Method
              <select style={S.select} value={form.method} onChange={f("method")} required>
                {["Inactivation Kit","DEA Disposal Site","Reverse Distributor","Other"].map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
            <div style={{ gridColumn: "1/-1" }}><button style={S.btnPrimary} type="submit">Save Waste Record</button></div>
          </form>
        </div>
      )}
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead><tr>{["Date","Stock","Drug","Qty","Reason","Disposed By","Witness","Method","By"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {records.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No waste records.</td></tr>}
              {records.map(r => (
                <tr key={r.id}>
                  <td style={S.td}>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={S.td}>{r.stock}</td>
                  <td style={S.td}>{r.drug} {r.conc}</td>
                  <td style={S.td}>{r.qty} {r.unit}</td>
                  <td style={S.td}>{r.reason}</td>
                  <td style={S.td}>{r.disposed_by}</td>
                  <td style={S.td}>{r.witness}</td>
                  <td style={S.td}>{r.method}</td>
                  <td style={S.td}>{r.logged_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Audits Tab ───────────────────────────────────────────────────────────────
function AuditsTab({ user }) {
  const now = new Date();
  const [records,  setRecords ] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [inv,      setInv     ] = useState({});
  // BUG-004 fix: "Sub-Stock 1" was renamed to "929"; use role-aware default
  const auditAvailStocks = user.role === "admin" ? getStocks(user) : getStocks(user).filter(s => s !== "Main Stock");
  const [stock,    setStock   ] = useState(user.role === "admin" ? "Main Stock" : auditAvailStocks[0]);
  const [auditor,  setAuditor ] = useState(user.name || "");
  const [witness,  setWitness ] = useState("");
  const [notes,    setNotes   ] = useState("");
  const [counts,    setCounts   ] = useState({});
  const [seals,     setSeals    ] = useState({}); // drugId → "intact"|"broken"|"missing"
  const [condition, setCondition] = useState({}); // drugId → "good"|"damaged"|"expired"
  const [err,       setErr      ] = useState("");
  const [msg,       setMsg      ] = useState("");
  const [year,      setYear     ] = useState(String(now.getFullYear()));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, i] = await Promise.all([api(`/api/audits?year=${year}`), api("/api/inventory")]);
      setRecords(r); setInv(i);
    } catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const stockDrugs  = inv[stock] || [];

  async function submit(e) {
    e.preventDefault();
    const results = stockDrugs.map(d => ({
      drug: d.drug, conc: d.conc, unit: d.unit, expected: d.qty,
      counted:   parseFloat(counts[d.id] ?? 0),
      match:     parseFloat(counts[d.id] ?? 0) === parseFloat(d.qty),
      seal:      seals[d.id]     || "intact",
      condition: condition[d.id] || "good",
    }));
    try {
      await api("/api/audits", { method: "POST", body: JSON.stringify({ stock, auditor, witness, results, notes }) });
      setMsg("Audit saved."); setShowForm(false);
      setCounts({}); setSeals({}); setCondition({}); setNotes(""); setWitness(""); load();
    } catch (ex) { setErr(ex.message); }
  }

  return (
    <div style={S.page}>
      <div style={{ ...S.row, justifyContent: "space-between" }}>
        <h2 style={S.h2}>Audits / Shift Count</h2>
        <button style={S.btnPrimary} onClick={() => setShowForm(v => !v)}>+ New Audit</button>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}
      <div style={S.filterRow}>
        <label style={S.label}>Year<input style={{ ...S.input, width: 80 }} value={year} onChange={e => setYear(e.target.value)} /></label>
        <button style={{ ...S.btnPrimary, alignSelf: "flex-end" }} onClick={load}>Filter</button>
      </div>
      {showForm && (
        <div style={S.card}>
          <h3 style={S.h3}>Shift Count Audit</h3>
          <div style={{ ...S.form3, marginBottom: 14 }}>
            <label style={S.label}>Stock<select style={S.select} value={stock} onChange={e => setStock(e.target.value)}>{auditAvailStocks.map(s=><option key={s}>{s}</option>)}</select></label>
            <label style={S.label}>Auditor<input style={S.input} value={auditor} onChange={e => setAuditor(e.target.value)} required /></label>
            <label style={S.label}>Witness<input style={S.input} value={witness} onChange={e => setWitness(e.target.value)} required /></label>
          </div>
          <form onSubmit={submit}>
            <table style={S.tbl}>
              <thead>
                <tr>{["Drug","Conc","Expected","Counted","Count Match","Seal Intact?","Vial Condition"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {stockDrugs.length === 0 && <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No drugs in this stock.</td></tr>}
                {stockDrugs.map(d => {
                  const counted  = parseFloat(counts[d.id] ?? "");
                  const match    = !isNaN(counted) && counted === parseFloat(d.qty);
                  const sealOk   = (seals[d.id] || "intact") === "intact";
                  const condOk   = (condition[d.id] || "good") === "good";
                  return (
                    <tr key={d.id} style={{ background: (!sealOk || !condOk) ? "#fff7ed" : "" }}>
                      <td style={S.td}><strong>{d.drug}</strong></td>
                      <td style={S.td}>{d.conc}</td>
                      <td style={S.td}><strong>{d.qty}</strong> {d.unit}</td>
                      <td style={S.td}>
                        <input style={{ ...S.input, width: 80 }} type="number" min="0" step="0.01"
                          value={counts[d.id] ?? ""} onChange={e => setCounts(p => ({ ...p, [d.id]: e.target.value }))} />
                      </td>
                      <td style={S.td}>
                        {counts[d.id] !== undefined && <span style={S.pill(match)}>{match ? "MATCH" : "DISCREPANCY"}</span>}
                      </td>
                      <td style={S.td}>
                        <select style={{ ...S.select, width: 100,
                          background: sealOk ? "#f0fdf4" : "#fef2f2",
                          color: sealOk ? "#166534" : "#dc2626" }}
                          value={seals[d.id] || "intact"}
                          onChange={e => setSeals(p => ({ ...p, [d.id]: e.target.value }))}>
                          <option value="intact">Intact</option>
                          <option value="broken">Broken</option>
                          <option value="missing">Missing</option>
                        </select>
                      </td>
                      <td style={S.td}>
                        <select style={{ ...S.select, width: 110,
                          background: condOk ? "#f0fdf4" : "#fef2f2",
                          color: condOk ? "#166534" : "#dc2626" }}
                          value={condition[d.id] || "good"}
                          onChange={e => setCondition(p => ({ ...p, [d.id]: e.target.value }))}>
                          <option value="good">Good</option>
                          <option value="damaged">Damaged</option>
                          <option value="expired">Expired</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <label style={{ ...S.label, marginTop: 12 }}>Notes / Observations
              <textarea style={S.textarea} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Any additional observations from this inspection…" />
            </label>
            <button style={{ ...S.btnPrimary, marginTop: 12 }} type="submit">Save Audit</button>
          </form>
        </div>
      )}
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead><tr>{["Date","Stock","Auditor","Witness","Count","Seals","Condition","Notes"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {records.length === 0 && <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No audits.</td></tr>}
              {records.map(r => {
                const res       = typeof r.results === "string" ? JSON.parse(r.results) : (r.results || []);
                const disc      = Array.isArray(res) ? res.filter(x => !x.match).length : 0;
                const sealIssue = Array.isArray(res) ? res.filter(x => x.seal && x.seal !== "intact").length : 0;
                const condIssue = Array.isArray(res) ? res.filter(x => x.condition && x.condition !== "good").length : 0;
                return (
                  <tr key={r.id}>
                    <td style={S.td}>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td style={S.td}>{r.stock}</td>
                    <td style={S.td}>{r.auditor}</td>
                    <td style={S.td}>{r.witness}</td>
                    <td style={S.td}><span style={S.pill(disc === 0)}>{disc === 0 ? "All Match" : `${disc} Discrepancy`}</span></td>
                    <td style={S.td}><span style={S.pill(sealIssue === 0)}>{sealIssue === 0 ? "All Intact" : `${sealIssue} Issue`}</span></td>
                    <td style={S.td}><span style={S.pill(condIssue === 0)}>{condIssue === 0 ? "All Good" : `${condIssue} Issue`}</span></td>
                    <td style={S.td}>{r.notes || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Monthly Logs Tab (admin) — DOH-3850 & DOH-3851 exports ──────────────────
function MonthlyLogsTab({ user }) {
  const now = new Date();
  const [logs,      setLogs     ] = useState({});
  const [loading,   setLoading  ] = useState(true);
  const [selYear,   setSelYear  ] = useState(now.getFullYear());
  const [selMonth,  setSelMonth ] = useState(now.getMonth());
  const [form,      setForm     ] = useState({ reviewedBy: user.name || "", mdReview: "", discrepancies: "", notes: "" });
  const [counts,    setCounts   ] = useState({ admins: 0, purchases: 0, transfers: 0, waste: 0 });
  const [err,       setErr      ] = useState("");
  const [msg,       setMsg      ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setLogs(await api("/api/monthly-logs")); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const p = `year=${selYear}&month=${selMonth}`;
      const [admins, purchases, transfers, waste] = await Promise.all([
        api(`/api/administrations?${p}&status=verified`),
        api(`/api/purchases?year=${selYear}`),
        api(`/api/transfers?year=${selYear}`),
        api(`/api/waste?year=${selYear}`),
      ]);
      const inMonth = arr => arr.filter(r => {
        const d = new Date(r.created_at);
        return d.getFullYear() === selYear && d.getMonth() === selMonth;
      });
      setCounts({ admins: admins.length, purchases: inMonth(purchases).length, transfers: inMonth(transfers).length, waste: inMonth(waste).length });
    } catch { /* non-fatal */ }
  }, [selYear, selMonth]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const key = `${selYear}-${String(selMonth + 1).padStart(2, "0")}`;
  const existing = logs[key];
  useEffect(() => {
    if (existing) {
      setForm({ reviewedBy: existing.reviewed_by || user.name || "", mdReview: existing.md_review || "", discrepancies: existing.discrepancies || "", notes: existing.notes || "" });
    } else {
      setForm({ reviewedBy: user.name || "", mdReview: "", discrepancies: "", notes: "" });
    }
  }, [existing, selYear, selMonth, user.name]);

  const ff = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  async function save(e) {
    e.preventDefault();
    try {
      await api("/api/monthly-logs", { method: "POST", body: JSON.stringify({
        year: selYear, month: selMonth,
        reviewedBy: form.reviewedBy, mdReview: form.mdReview,
        discrepancies: form.discrepancies, notes: form.notes,
        admins: counts.admins, purchases: counts.purchases, transfers: counts.transfers, waste: counts.waste,
      })});
      setMsg("Monthly log saved."); load();
    } catch (ex) { setErr(ex.message); }
  }

  return (
    <div style={S.page}>
      <h2 style={S.h2}>Monthly Logs</h2>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}

      {/* Month selector + activity counts */}
      <div style={S.card}>
        <div style={{ ...S.row, marginBottom: 16 }}>
          <label style={S.label}>Year
            <select style={S.select} value={selYear} onChange={e => setSelYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label style={S.label}>Month
            <select style={S.select} value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Administrations", val: counts.admins },
            { label: "Purchases",       val: counts.purchases },
            { label: "Transfers",       val: counts.transfers },
            { label: "Waste Records",   val: counts.waste },
          ].map(({ label, val }) => (
            <div key={label} style={S.statBox}>
              <div style={S.statNum}>{val}</div>
              <div style={S.statLabel}>{label}</div>
            </div>
          ))}
        </div>

        <form onSubmit={save} style={S.form2}>
          <label style={S.label}>Reviewed By<input style={S.input} value={form.reviewedBy} onChange={ff("reviewedBy")} required /></label>
          <label style={S.label}>Medical Director Sign-Off<input style={S.input} value={form.mdReview} onChange={ff("mdReview")} placeholder="Name / date" /></label>
          <label style={{ ...S.label, gridColumn: "1/-1" }}>Discrepancies Noted
            <textarea style={S.textarea} value={form.discrepancies} onChange={ff("discrepancies")} placeholder="Describe any discrepancies, or enter 'None'" />
          </label>
          <label style={{ ...S.label, gridColumn: "1/-1" }}>Notes
            <textarea style={S.textarea} value={form.notes} onChange={ff("notes")} />
          </label>
          <div style={{ gridColumn: "1/-1" }}>
            <button style={S.btnPrimary} type="submit">Save Monthly Log</button>
          </div>
        </form>
      </div>

      {/* DOH Exports pointer */}
      <div style={{ ...S.card, background: "#f0f9ff", border: "1px solid #bae6fd" }}>
        <p style={{ margin: 0, fontSize: 13, color: "#0369a1" }}>
          <strong>DOH form exports</strong> (3850, 3851, 4004, 3848, Annual) are available in the{" "}
          <strong>DOH Exports</strong> tab. Forms are generated as running ledgers per drug and date
          range — not per month — to match how the physical forms work.
        </p>
      </div>

      {/* Log history */}
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <h3 style={S.h3}>Log History</h3>
          <table style={S.tbl}>
            <thead><tr>{["Month","Reviewed By","MD Sign-Off","Admins","Purchases","Transfers","Waste","Saved By","Saved"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {Object.keys(logs).length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No logs saved yet.</td></tr>}
              {Object.entries(logs).sort(([a],[b]) => b.localeCompare(a)).map(([k, r]) => (
                <tr key={k}>
                  <td style={S.td}><strong>{MONTHS[r.month]} {r.year}</strong></td>
                  <td style={S.td}>{r.reviewed_by}</td>
                  <td style={S.td}>{r.md_review || "—"}</td>
                  <td style={S.td}>{r.admin_count}</td>
                  <td style={S.td}>{r.purchase_count}</td>
                  <td style={S.td}>{r.transfer_count}</td>
                  <td style={S.td}>{r.waste_count}</td>
                  <td style={S.td}>{r.saved_by}</td>
                  <td style={S.td}>{r.saved_at ? new Date(r.saved_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Users Tab (admin) ────────────────────────────────────────────────────────
function UsersTab({ currentUser }) {
  const blankNew  = () => ({ username: "", email: "", password: "", name: "", badge: "", role: "user" });
  const blankLink = () => ({ email: "", badge: "", role: "user" });

  const [users,     setUsers    ] = useState([]);
  const [loading,   setLoading  ] = useState(true);
  const [panel,     setPanel    ] = useState(null); // null | "new" | "existing"
  const [formNew,   setFormNew  ] = useState(blankNew());
  const [formLink,  setFormLink ] = useState(blankLink());
  const [linkFound, setLinkFound] = useState(null); // user record returned by lookup
  const [linkBusy,  setLinkBusy ] = useState(false);
  const [editId,    setEditId   ] = useState(null);
  const [editData,  setEditData ] = useState({});
  const [resetId,   setResetId  ] = useState(null); // user id whose password is being reset
  const [resetPw,   setResetPw  ] = useState({ pw: "", pw2: "" });
  const [err,       setErr      ] = useState("");
  const [msg,       setMsg      ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await api("/api/users")); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fn = k => e => setFormNew(p  => ({ ...p, [k]: e.target.value }));
  const fl = k => e => setFormLink(p => ({ ...p, [k]: e.target.value }));

  // ── Create brand-new user ──
  async function addNewUser(e) {
    e.preventDefault(); setErr("");
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(formNew) });
      setMsg("User created and added to this agency."); setPanel(null); setFormNew(blankNew()); load();
    } catch (ex) { setErr(ex.message); }
  }

  // ── Look up existing user by email ──
  async function lookupUser(e) {
    e.preventDefault(); setErr(""); setLinkFound(null); setLinkBusy(true);
    try {
      const found = await api(`/api/users/lookup?email=${encodeURIComponent(formLink.email)}`);
      setLinkFound(found);
      if (found.already_member) setMsg(`${found.name} is already in this agency (${found.existing_role}). You can update their role/badge below.`);
    } catch (ex) { setErr(ex.message); }
    finally { setLinkBusy(false); }
  }

  // ── Add / update existing user in this agency ──
  async function addExistingUser(e) {
    e.preventDefault(); setErr("");
    try {
      await api("/api/users/add-existing", {
        method: "POST",
        body: JSON.stringify({ user_id: linkFound.id, role: formLink.role, badge: formLink.badge }),
      });
      setMsg(`${linkFound.name} added to this agency as ${formLink.role}.`);
      setPanel(null); setFormLink(blankLink()); setLinkFound(null); load();
    } catch (ex) { setErr(ex.message); }
  }

  async function saveEdit(id) {
    try {
      await api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(editData) });
      setMsg("User updated."); setEditId(null); setEditData({}); load();
    } catch (ex) { setErr(ex.message); }
  }

  async function removeUser(id, name) {
    if (!window.confirm(`Remove ${name} from this agency? Their account will still exist for other agencies.`)) return;
    try {
      await api(`/api/users/${id}`, { method: "DELETE" });
      setMsg(`${name} removed from this agency.`); load();
    } catch (ex) { setErr(ex.message); }
  }

  async function resetPassword(u, e) {
    e.preventDefault(); setErr("");
    if (resetPw.pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (resetPw.pw !== resetPw.pw2) { setErr("Passwords do not match."); return; }
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ new_password: resetPw.pw }) });
      setMsg(`Password reset for ${u.name}.`);
      setResetId(null); setResetPw({ pw: "", pw2: "" });
    } catch (ex) { setErr(ex.message); }
  }

  return (
    <div style={S.page}>
      <div style={{ ...S.row, justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h2 style={S.h2}>User Management</h2>
        <span style={{ display: "flex", gap: 8 }}>
          <button style={S.btnPrimary} onClick={() => setPanel(p => p === "new" ? null : "new")}>+ Create New User</button>
          <button style={{ ...S.btnPrimary, background: "#7c3aed" }} onClick={() => setPanel(p => p === "existing" ? null : "existing")}>+ Add Existing User</button>
        </span>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}

      {/* ── Create new user panel ── */}
      {panel === "new" && (
        <div style={S.card}>
          <h3 style={S.h3}>Create New User</h3>
          <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
            Creates a brand-new NarcTrack account and adds it to this agency.
          </p>
          <form onSubmit={addNewUser} style={S.form3}>
            <label style={S.label}>Username<input style={S.input} value={formNew.username} onChange={fn("username")} required /></label>
            <label style={S.label}>Email<input style={S.input} type="email" value={formNew.email} onChange={fn("email")} /></label>
            <label style={S.label}>Password<span style={{ fontSize: 11, color: "#94a3b8" }}>(blank = Google sign-in only)</span><input style={S.input} type="password" value={formNew.password} onChange={fn("password")} /></label>
            <label style={S.label}>Full Name<input style={S.input} value={formNew.name} onChange={fn("name")} required /></label>
            <label style={S.label}>Badge #<input style={S.input} value={formNew.badge} onChange={fn("badge")} required /></label>
            <label style={S.label}>Role
              <select style={S.select} value={formNew.role} onChange={fn("role")}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="pending">Pending</option>
              </select>
            </label>
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 8 }}>
              <button style={S.btnPrimary} type="submit">Create User</button>
              <button style={{ ...S.btn, background: "#e2e8f0", color: "#475569" }} type="button" onClick={() => setPanel(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Add existing user panel ── */}
      {panel === "existing" && (
        <div style={S.card}>
          <h3 style={S.h3}>Add Existing User to This Agency</h3>
          <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
            Look up a user who already has a NarcTrack account (at another agency) and grant them access here with their own role and badge number.
          </p>
          {/* Email lookup */}
          <form onSubmit={lookupUser} style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "flex-end" }}>
            <label style={{ ...S.label, flex: 1 }}>
              User's Email Address
              <input style={S.input} type="email" value={formLink.email} onChange={fl("email")} required placeholder="their@email.com" />
            </label>
            <button style={S.btnPrimary} type="submit" disabled={linkBusy}>{linkBusy ? "Searching…" : "Look Up"}</button>
            <button style={{ ...S.btn, background: "#e2e8f0", color: "#475569" }} type="button" onClick={() => { setPanel(null); setLinkFound(null); setFormLink(blankLink()); }}>Cancel</button>
          </form>
          {/* Result */}
          {linkFound && (
            <form onSubmit={addExistingUser}>
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
                ✅ Found: <strong>{linkFound.name}</strong> ({linkFound.email})
                {linkFound.already_member && <span style={{ marginLeft: 8, color: "#d97706" }}>· Already a member — saving will update their role/badge</span>}
              </div>
              <div style={S.form3}>
                <label style={S.label}>Badge # for This Agency<input style={S.input} value={formLink.badge} onChange={fl("badge")} required /></label>
                <label style={S.label}>Role for This Agency
                  <select style={S.select} value={formLink.role} onChange={fl("role")}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="pending">Pending</option>
                  </select>
                </label>
                <div style={{ gridColumn: "1/-1" }}>
                  <button style={{ ...S.btnPrimary, background: "#7c3aed" }} type="submit">
                    {linkFound.already_member ? "Update Role / Badge" : "Add to This Agency"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── User table ── */}
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead>
              <tr>{["", "Name", "Username", "Email", "Badge", "Role", "Actions"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No users in this agency yet.</td></tr>
              )}
              {users.map(u => {
                const initials = (u.name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
                const isResetting = resetId === u.id;
                return (
                  <React.Fragment key={u.id}>
                    <tr>
                      <td style={{ ...S.td, width: 40 }}>
                        {u.avatar
                          ? <img src={u.avatar} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
                          : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", fontWeight: 700 }}>{initials}</div>
                        }
                      </td>
                      <td style={S.td}>
                        {editId === u.id
                          ? <input style={{ ...S.input, width: 130 }} value={editData.name ?? u.name} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))} />
                          : u.name}
                      </td>
                      <td style={S.td}>
                        {editId === u.id
                          ? <input style={{ ...S.input, width: 110 }} value={editData.username ?? u.username} onChange={e => setEditData(p => ({ ...p, username: e.target.value }))} />
                          : u.username}
                      </td>
                      <td style={S.td}>
                        {editId === u.id
                          ? <input style={{ ...S.input, width: 160 }} type="email" value={editData.email ?? u.email} onChange={e => setEditData(p => ({ ...p, email: e.target.value }))} />
                          : u.email}
                      </td>
                      <td style={S.td}>
                        {editId === u.id
                          ? <input style={{ ...S.input, width: 80 }} value={editData.badge ?? u.badge} onChange={e => setEditData(p => ({ ...p, badge: e.target.value }))} />
                          : u.badge}
                      </td>
                      <td style={S.td}>
                        {editId === u.id ? (
                          <select style={S.select} value={editData.role ?? u.role} onChange={e => setEditData(p => ({ ...p, role: e.target.value }))}>
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                            <option value="pending">Pending</option>
                          </select>
                        ) : <span style={S.roleBadge(u.role)}>{u.role}</span>}
                      </td>
                      <td style={S.td}>
                        {editId === u.id ? (
                          <span style={{ display: "flex", gap: 4 }}>
                            <button style={S.btnSuccess} onClick={() => saveEdit(u.id)}>Save</button>
                            <button style={S.btnGray} onClick={() => { setEditId(null); setEditData({}); }}>Cancel</button>
                          </span>
                        ) : (
                          <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <button style={S.btnGray} onClick={() => { setEditId(u.id); setEditData({}); setResetId(null); }}>Edit</button>
                            <button style={{ ...S.btnGray, background: "#f59e0b", color: "#fff" }}
                              onClick={() => { setResetId(isResetting ? null : u.id); setResetPw({ pw: "", pw2: "" }); setEditId(null); }}>
                              🔑 {isResetting ? "Cancel" : "Reset PW"}
                            </button>
                            {u.id !== currentUser.id && (
                              <button style={S.btnDanger} onClick={() => removeUser(u.id, u.name)}>Remove</button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isResetting && (
                      <tr key={`${u.id}-reset`}>
                        <td colSpan={7} style={{ ...S.td, background: "#fffbeb", padding: "12px 16px" }}>
                          <form onSubmit={e => resetPassword(u, e)}
                            style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e", alignSelf: "center" }}>
                              🔑 Reset password for <strong>{u.name}</strong>
                            </div>
                            <label style={{ ...S.label, margin: 0 }}>
                              <span style={{ fontSize: 11 }}>New Password</span>
                              <input style={{ ...S.input, width: 160 }} type="password" required minLength={8}
                                placeholder="min 8 characters"
                                value={resetPw.pw} onChange={e => setResetPw(p => ({ ...p, pw: e.target.value }))} />
                            </label>
                            <label style={{ ...S.label, margin: 0 }}>
                              <span style={{ fontSize: 11 }}>Confirm Password</span>
                              <input style={{ ...S.input, width: 160 }} type="password" required
                                placeholder="repeat password"
                                value={resetPw.pw2} onChange={e => setResetPw(p => ({ ...p, pw2: e.target.value }))} />
                            </label>
                            <button style={{ ...S.btnPrimary, background: "#f59e0b", alignSelf: "flex-end" }} type="submit">
                              Set Password
                            </button>
                          </form>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: "#94a3b8", margin: "12px 0 0" }}>
            "Remove" removes the user from <em>this agency only</em> — their account remains active at any other agencies they belong to.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Nav avatar — receives src from MainApp (no per-render fetch) ─────────────
function NavAvatar({ user, src }) {
  const initials = (user.name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  if (src) return <img src={src} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", border: "2px solid #475569" }} />;
  return <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>{initials}</div>;
}

// ─── Profile Tab — available to all users ─────────────────────────────────────
function ProfileTab({ user, onAvatarUpdate }) {
  const [profile,     setProfile    ] = useState(null);
  const [loading,     setLoading    ] = useState(true);
  const [err,         setErr        ] = useState("");
  const [msg,         setMsg        ] = useState("");
  const [pw,          setPw         ] = useState({ current: "", newPw: "", confirm: "" });
  const [pwBusy,      setPwBusy     ] = useState(false);
  const [pwErr,       setPwErr      ] = useState("");
  const [pwMsg,       setPwMsg      ] = useState("");
  const [avatarBusy,  setAvatarBusy ] = useState(false);

  useEffect(() => {
    api("/api/users/me")
      .then(setProfile)
      .catch(ex => setErr(ex.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Avatar upload ──
  async function onAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("Please select an image file."); return; }
    setAvatarBusy(true); setErr(""); setMsg("");
    try {
      const dataUrl = await resizeImage(file, 200);
      await api("/api/users/me", { method: "PATCH", body: JSON.stringify({ avatar: dataUrl }) });
      setProfile(p => ({ ...p, avatar: dataUrl }));
      onAvatarUpdate?.(dataUrl);
      setMsg("Profile picture updated.");
    } catch (ex) { setErr(ex.message); }
    finally { setAvatarBusy(false); e.target.value = ""; }
  }

  async function removeAvatar() {
    setErr(""); setMsg("");
    try {
      await api("/api/users/me", { method: "PATCH", body: JSON.stringify({ avatar: null }) });
      setProfile(p => ({ ...p, avatar: null }));
      onAvatarUpdate?.(null);
      setMsg("Profile picture removed.");
    } catch (ex) { setErr(ex.message); }
  }

  // ── Password change ──
  async function savePassword(e) {
    e.preventDefault();
    setPwErr(""); setPwMsg("");
    if (pw.newPw !== pw.confirm) { setPwErr("New passwords do not match."); return; }
    if (pw.newPw.length < 8)    { setPwErr("New password must be at least 8 characters."); return; }
    setPwBusy(true);
    try {
      await api("/api/users/me", { method: "PATCH", body: JSON.stringify({
        currentPassword:    pw.current,
        newPassword:        pw.newPw,
        confirmNewPassword: pw.confirm,
      })});
      setPwMsg("Password updated successfully. Use it next time you administer a medication.");
      setPw({ current: "", newPw: "", confirm: "" });
    } catch (ex) { setPwErr(ex.message); }
    finally { setPwBusy(false); }
  }

  if (loading) return <div style={S.loading}>Loading profile…</div>;

  const initials = (profile?.name || user.name || "?")
    .split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  const roStyle = { ...S.input, background: "#f1f5f9", color: "#64748b", cursor: "default" };

  return (
    <div style={S.page}>
      <h2 style={S.h2}>My Profile</h2>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}

      {/* ── Avatar ── */}
      <div style={S.card}>
        <h3 style={S.h3}>Profile Picture</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          {profile?.avatar
            ? <img src={profile.avatar} alt="avatar"
                style={{ width: 90, height: 90, borderRadius: "50%", objectFit: "cover", border: "3px solid #e2e8f0", flexShrink: 0 }} />
            : <div style={{ width: 90, height: 90, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                {initials}
              </div>
          }
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ ...S.btnPrimary, cursor: "pointer", userSelect: "none" }}>
              {avatarBusy ? "Uploading…" : "📷 Upload Photo"}
              <input type="file" accept="image/*" style={{ display: "none" }}
                onChange={onAvatarChange} disabled={avatarBusy} />
            </label>
            {profile?.avatar && (
              <button style={{ ...S.btn, background: "#e2e8f0", color: "#475569" }} onClick={removeAvatar}>
                Remove Photo
              </button>
            )}
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              JPG, PNG, GIF — auto-resized to 200×200 px
            </span>
          </div>
        </div>
      </div>

      {/* ── Account info (read-only for non-admin) ── */}
      <div style={S.card}>
        <h3 style={S.h3}>Account Information</h3>
        <div style={S.form3}>
          <label style={S.label}>Full Name<input style={roStyle} value={profile?.name || ""} readOnly /></label>
          <label style={S.label}>
            Username
            {user.role !== "admin" && <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>· admin editable</span>}
            <input style={roStyle} value={profile?.username || ""} readOnly />
          </label>
          <label style={S.label}>
            Email
            {user.role !== "admin" && <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>· admin editable</span>}
            <input style={roStyle} value={profile?.email || ""} readOnly />
          </label>
          <label style={S.label}>
            Badge #
            {user.role !== "admin" && <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>· admin editable</span>}
            <input style={roStyle} value={profile?.badge || ""} readOnly />
          </label>
          <label style={S.label}>Role<input style={roStyle} value={profile?.role || ""} readOnly /></label>
        </div>
        {user.role !== "admin" && (
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "12px 0 0" }}>
            Contact your administrator to update your name, username, email, or badge number.
          </p>
        )}
      </div>

      {/* ── Change password ── */}
      <div style={S.card}>
        <h3 style={S.h3}>
          {profile?.has_password ? "Change Password" : "Set a Password"}
        </h3>
        {!profile?.has_password && (
          <div style={{ ...S.okBox, marginBottom: 14 }}>
            ⚠ You signed in with Google and have no local password yet.
            Setting one is required to submit drug administration records.
          </div>
        )}
        {pwErr && <div style={S.errBox}>{pwErr}</div>}
        {pwMsg && <div style={S.okBox}>{pwMsg}</div>}
        <form onSubmit={savePassword} style={S.form3}>
          {profile?.has_password && (
            <label style={S.label}>Current Password
              <input style={S.input} type="password" value={pw.current}
                onChange={e => setPw(p => ({ ...p, current: e.target.value }))}
                autoComplete="current-password" required />
            </label>
          )}
          <label style={S.label}>New Password
            <input style={S.input} type="password" value={pw.newPw}
              onChange={e => setPw(p => ({ ...p, newPw: e.target.value }))}
              autoComplete="new-password" placeholder="Min. 8 characters" required />
          </label>
          <label style={S.label}>Confirm New Password
            <input style={S.input} type="password" value={pw.confirm}
              onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))}
              autoComplete="new-password" required />
          </label>
          <div style={{ gridColumn: "1/-1" }}>
            <button style={S.btnPrimary} type="submit" disabled={pwBusy}>
              {pwBusy ? "Saving…" : profile?.has_password ? "Update Password" : "Set Password"}
            </button>
          </div>
        </form>
        <p style={{ fontSize: 12, color: "#64748b", margin: "12px 0 0" }}>
          🔐 Your password is required each time you submit a drug administration record (§80.136 compliance).
        </p>
      </div>
    </div>
  );
}

// ─── Agency Settings Tab (admin) ─────────────────────────────────────────────
function AgencySettingsTab() {
  const [form,    setForm   ] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy   ] = useState(false);
  const [err,     setErr    ] = useState("");
  const [msg,     setMsg    ] = useState("");

  useEffect(() => {
    api("/api/agency")
      .then(ag => setForm({
        agency_code:    ag.agency_code    || "",
        cs_license:     ag.cs_license     || "",
        bne_license:    ag.bne_license    || "",
        dea_number:     ag.dea_number     || "",
        dea_registrant: ag.dea_registrant || "",
        cs_agent_name:  ag.cs_agent_name  || "",
        cs_agent_phone: ag.cs_agent_phone || "",
        cs_agent_email: ag.cs_agent_email || "",
        contact_name:   ag.contact_name   || "",
        contact_phone:  ag.contact_phone  || "",
        contact_email:  ag.contact_email  || "",
        address:        ag.address        || "",
        address2:       ag.address2       || "",
        city:           ag.city           || "",
        state:          ag.state          || "",
        zip:            ag.zip            || "",
        county:         ag.county         || "",
      }))
      .catch(ex => setErr(ex.message))
      .finally(() => setLoading(false));
  }, []);

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr(""); setMsg("");
    try {
      await api("/api/agency", { method: "PATCH", body: JSON.stringify(form) });
      setMsg("Agency settings saved.");
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  if (loading) return <div style={S.loading}>Loading…</div>;

  const required = { borderLeft: "3px solid #f59e0b" };
  const reqLabel = <span style={{ color: "#f59e0b", fontWeight: 700, marginLeft: 4 }}>*</span>;

  return (
    <div style={S.page}>
      <h2 style={S.h2}>Agency Settings</h2>
      <div style={{ ...S.errBox, background: "#fef3c7", color: "#92400e", borderColor: "#f59e0b",
                    border: "1px solid #f59e0b", marginBottom: 16, fontSize: 13 }}>
        <strong>Fields marked <span style={{ color: "#f59e0b" }}>*</span> are required for DOH form exports.</strong>{" "}
        Exports will be blocked until all required fields are completed.
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}

      <form onSubmit={save}>
        {/* ── Compliance IDs ── */}
        <div style={S.card}>
          <h3 style={S.h3}>Compliance Identifiers</h3>
          <div style={S.form3}>
            <label style={S.label}>NYS EMS Agency Code {reqLabel}
              <input style={{ ...S.input, ...required }} value={form.agency_code} onChange={f("agency_code")} placeholder="e.g. 1234" required />
            </label>
            <label style={S.label}>NYS CS License # {reqLabel}
              <input style={{ ...S.input, ...required }} value={form.cs_license} onChange={f("cs_license")} placeholder="CS-XXXXXX" required />
            </label>
            <label style={S.label}>BNE Class 3C License #
              <input style={S.input} value={form.bne_license} onChange={f("bne_license")} placeholder="03C-XXXXXX" />
            </label>
            <label style={S.label}>DEA Registration # {reqLabel}
              <input style={{ ...S.input, ...required }} value={form.dea_number} onChange={f("dea_number")} placeholder="XX0000000" required />
            </label>
            <label style={S.label}>DEA Registrant Name
              <input style={S.input} value={form.dea_registrant} onChange={f("dea_registrant")} />
            </label>
          </div>
        </div>

        {/* ── CS Agent ── */}
        <div style={S.card}>
          <h3 style={S.h3}>Controlled Substance Agent</h3>
          <div style={S.form3}>
            <label style={S.label}>CS Agent Name {reqLabel}
              <input style={{ ...S.input, ...required }} value={form.cs_agent_name} onChange={f("cs_agent_name")} required />
            </label>
            <label style={S.label}>CS Agent Phone
              <input style={S.input} value={form.cs_agent_phone} onChange={f("cs_agent_phone")} placeholder="(555) 555-5555" />
            </label>
            <label style={S.label}>CS Agent Email
              <input style={S.input} type="email" value={form.cs_agent_email} onChange={f("cs_agent_email")} />
            </label>
          </div>
        </div>

        {/* ── DEA Contact ── */}
        <div style={S.card}>
          <h3 style={S.h3}>DEA Registrant Contact</h3>
          <div style={S.form3}>
            <label style={S.label}>Contact Name
              <input style={S.input} value={form.contact_name} onChange={f("contact_name")} />
            </label>
            <label style={S.label}>Contact Phone
              <input style={S.input} value={form.contact_phone} onChange={f("contact_phone")} />
            </label>
            <label style={S.label}>Contact Email
              <input style={S.input} type="email" value={form.contact_email} onChange={f("contact_email")} />
            </label>
          </div>
        </div>

        {/* ── Address ── */}
        <div style={S.card}>
          <h3 style={S.h3}>Agency Address</h3>
          <div style={S.form3}>
            <label style={{ ...S.label, gridColumn: "1/-1" }}>Address Line 1
              <input style={S.input} value={form.address} onChange={f("address")} />
            </label>
            <label style={{ ...S.label, gridColumn: "1/-1" }}>Address Line 2
              <input style={S.input} value={form.address2} onChange={f("address2")} />
            </label>
            <label style={S.label}>City<input style={S.input} value={form.city} onChange={f("city")} /></label>
            <label style={S.label}>State<input style={S.input} value={form.state} onChange={f("state")} placeholder="NY" /></label>
            <label style={S.label}>Zip<input style={S.input} value={form.zip} onChange={f("zip")} /></label>
            <label style={S.label}>County<input style={S.input} value={form.county} onChange={f("county")} /></label>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button style={S.btnPrimary} type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save Agency Settings"}
          </button>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            These values appear on all DOH form exports.
          </span>
        </div>
      </form>
    </div>
  );
}

// ─── DOH Exports Tab ──────────────────────────────────────────────────────────
function ExportsTab({ user }) {
  const [inv,  setInv ] = useState([]);
  const [busy, setBusy] = useState("");
  const [err,  setErr ] = useState("");

  useEffect(() => { api("/api/inventory").then(setInv).catch(() => {}); }, []);

  const allStocks = getStocks(user);
  const substocks = allStocks.filter(s => s !== "Main Stock");
  const drugs = [...new Set(inv.map(i => i.drug))].sort();

  const now      = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const ago30    = new Date(now - 30 * 24 * 3600 * 1000).toISOString().split("T")[0];

  const [f3850,   setF3850  ] = useState({ drug: "",  from: ago30,   to: todayStr });
  const [f3851,   setF3851  ] = useState({ stock: "", drug: "", from: ago30, to: todayStr });
  const [f4004,   setF4004  ] = useState({ drug: "",  from: ago30,   to: todayStr });
  const [f3848,   setF3848  ] = useState({ year: String(now.getFullYear()), half: "1" });
  const [fAnnual, setFAnnual] = useState({ year: String(now.getFullYear()) });

  async function doExport(type, params) {
    setBusy(type); setErr("");
    try {
      await downloadExport(`/api/export/${type}?${new URLSearchParams(params)}`);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(""); }
  }

  const ExportCard = ({ title, desc, color, children, onDownload, disabled }) => (
    <div style={S.card}>
      <h3 style={S.h3}>{title}</h3>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px" }}>{desc}</p>
      <div style={S.form3}>{children}</div>
      <button style={{ ...S.btnExport(color), marginTop: 12, opacity: disabled ? 0.5 : 1 }}
        disabled={disabled || !!busy} onClick={onDownload}>
        {busy === title ? "Generating…" : `⬇ Download ${title}`}
      </button>
    </div>
  );

  return (
    <div style={S.page}>
      <h2 style={S.h2}>NYS DOH Form Exports</h2>
      <p style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>
        All files are CSV. Open in Excel via <em>File → Open → Comma delimited</em>.
        Quantities are shown in mL (as recorded) and mg (as required on DOH forms).
        Each DOH form is a running ledger — select a date range covering the entries you need.
      </p>
      {err && <div style={S.errBox}>{err}</div>}

      <ExportCard
        title="DOH-3850" color="#0ea5e9"
        desc="Main Stock → Sub-Stock distribution log. One form per drug. Records every transfer out of Main Stock. File a new sheet per lot received."
        disabled={!f3850.drug}
        onDownload={() => doExport("doh3850", f3850)}>
        <label style={S.label}>Drug
          <select style={S.input} value={f3850.drug} onChange={e => setF3850(p => ({ ...p, drug: e.target.value }))}>
            <option value="">— select drug —</option>
            {drugs.map(d => <option key={d}>{d}</option>)}
          </select>
        </label>
        <label style={S.label}>From Date
          <input type="date" style={S.input} value={f3850.from} onChange={e => setF3850(p => ({ ...p, from: e.target.value }))} />
        </label>
        <label style={S.label}>To Date
          <input type="date" style={S.input} value={f3850.to} onChange={e => setF3850(p => ({ ...p, to: e.target.value }))} />
        </label>
      </ExportCard>

      <ExportCard
        title="DOH-3851" color="#7c3aed"
        desc="Sub-Stock running ledger per drug. Shows every event (restocks in, administrations out, waste out) with running balance in mg."
        disabled={!f3851.stock || !f3851.drug}
        onDownload={() => doExport("doh3851", f3851)}>
        <label style={S.label}>Stock Location
          <select style={S.input} value={f3851.stock} onChange={e => setF3851(p => ({ ...p, stock: e.target.value }))}>
            <option value="">— select stock —</option>
            {allStocks.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label style={S.label}>Drug
          <select style={S.input} value={f3851.drug} onChange={e => setF3851(p => ({ ...p, drug: e.target.value }))}>
            <option value="">— select drug —</option>
            {drugs.map(d => <option key={d}>{d}</option>)}
          </select>
        </label>
        <label style={S.label}>From Date
          <input type="date" style={S.input} value={f3851.from} onChange={e => setF3851(p => ({ ...p, from: e.target.value }))} />
        </label>
        <label style={S.label}>To Date
          <input type="date" style={S.input} value={f3851.to} onChange={e => setF3851(p => ({ ...p, to: e.target.value }))} />
        </label>
      </ExportCard>

      <ExportCard
        title="DOH-4004" color="#059669"
        desc="Controlled substance utilization record per drug. Current inventory balance across all stocks, all verified administrations with mg quantities."
        disabled={!f4004.drug}
        onDownload={() => doExport("doh4004", f4004)}>
        <label style={S.label}>Drug
          <select style={S.input} value={f4004.drug} onChange={e => setF4004(p => ({ ...p, drug: e.target.value }))}>
            <option value="">— select drug —</option>
            {drugs.map(d => <option key={d}>{d}</option>)}
          </select>
        </label>
        <label style={S.label}>From Date
          <input type="date" style={S.input} value={f4004.from} onChange={e => setF4004(p => ({ ...p, from: e.target.value }))} />
        </label>
        <label style={S.label}>To Date
          <input type="date" style={S.input} value={f4004.to} onChange={e => setF4004(p => ({ ...p, to: e.target.value }))} />
        </label>
      </ExportCard>

      <ExportCard
        title="DOH-3848" color="#dc2626"
        desc="Semi-annual report submitted to BNE and Bureau of EMS within 30 days of June 30 (H1) or December 31 (H2). Includes full drug activity summary, inventory, and all detail records."
        onDownload={() => doExport("doh3848", f3848)}>
        <label style={S.label}>Year
          <input type="number" style={S.input} value={f3848.year} min="2020" max="2099"
            onChange={e => setF3848(p => ({ ...p, year: e.target.value }))} />
        </label>
        <label style={S.label}>Reporting Period
          <select style={S.input} value={f3848.half} onChange={e => setF3848(p => ({ ...p, half: e.target.value }))}>
            <option value="1">H1 — January through June</option>
            <option value="2">H2 — July through December</option>
          </select>
        </label>
      </ExportCard>

      <ExportCard
        title="Annual Summary" color="#475569"
        desc="Full-year internal summary across all drugs. Not a DOH-required form — for internal records and self-audits."
        onDownload={() => doExport("annual", fAnnual)}>
        <label style={S.label}>Year
          <input type="number" style={S.input} value={fAnnual.year} min="2020" max="2099"
            onChange={e => setFAnnual(p => ({ ...p, year: e.target.value }))} />
        </label>
      </ExportCard>
    </div>
  );
}

// ─── Weekly Round Wizard ──────────────────────────────────────────────────────
function WeeklyRoundTab({ user }) {
  const stocks = getStocks(user);

  const [inv,        setInv       ] = useState({});
  const [loading,    setLoading   ] = useState(true);
  const [step,       setStep      ] = useState("start"); // "start" | 0..n | "review" | "done"
  const [auditor,    setAuditor   ] = useState(user.name || "");
  const [witness,    setWitness   ] = useState("");
  const [roundNotes, setRoundNotes] = useState("");
  const [results,    setResults   ] = useState({});    // { stockIdx: { drugId: {counted,seal,condition} } }
  const [submitting, setSubmitting] = useState(false);
  const [err,        setErr       ] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [doneIssues, setDoneIssues] = useState([]);

  useEffect(() => {
    api("/api/inventory")
      .then(data => {
        setInv(data);
        setResults(buildDefaults(stocks, data));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function buildDefaults(stocks, data) {
    const defs = {};
    stocks.forEach((stock, si) => {
      defs[si] = {};
      (data[stock] || []).forEach(d => {
        defs[si][d.id] = { counted: String(d.qty), seal: "intact", condition: "good" };
      });
    });
    return defs;
  }

  function setField(si, drugId, field, value) {
    setResults(prev => ({
      ...prev,
      [si]: { ...prev[si], [drugId]: { ...prev[si]?.[drugId], [field]: value } },
    }));
  }

  function collectIssues(resultsSnap) {
    const issues = [];
    stocks.forEach((stock, si) => {
      (inv[stock] || []).forEach(d => {
        const r = resultsSnap[si]?.[d.id];
        if (!r) return;
        const counted = parseFloat(r.counted);
        if (!isNaN(counted) && counted !== parseFloat(d.qty))
          issues.push({ stock, drug: d.drug, conc: d.conc, type: "count", expected: d.qty, counted });
        if (r.seal !== "intact")
          issues.push({ stock, drug: d.drug, conc: d.conc, type: "seal", value: r.seal });
        if (r.condition !== "good")
          issues.push({ stock, drug: d.drug, conc: d.conc, type: "condition", value: r.condition });
      });
    });
    return issues;
  }

  async function completeRound() {
    setSubmitting(true); setErr("");
    try {
      const dateLabel = new Date().toLocaleDateString("en-US");
      await Promise.all(stocks.map((stock, si) => {
        const drugs       = inv[stock] || [];
        const stockResults = drugs.map(d => {
          const r       = results[si]?.[d.id] || { counted: String(d.qty), seal: "intact", condition: "good" };
          const counted = parseFloat(r.counted ?? d.qty);
          return {
            drug: d.drug, conc: d.conc, unit: d.unit,
            expected: d.qty, counted,
            match:     counted === parseFloat(d.qty),
            seal:      r.seal      || "intact",
            condition: r.condition || "good",
          };
        });
        const note = [`Weekly Round — ${dateLabel}`, roundNotes].filter(Boolean).join(". ");
        return api("/api/audits", {
          method: "POST",
          body:   JSON.stringify({ stock, auditor, witness, results: stockResults, notes: note }),
        });
      }));
      const issues = collectIssues(results);
      setSavedCount(stocks.length);
      setDoneIssues(issues);
      setStep("done");
    } catch (ex) { setErr(ex.message); }
    finally { setSubmitting(false); }
  }

  function resetWizard() {
    setStep("start"); setWitness(""); setRoundNotes(""); setErr("");
    setResults(buildDefaults(stocks, inv));
  }

  if (loading) return <div style={S.loading}>Loading inventory…</div>;

  // ── Done ──────────────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div style={S.page}>
        <h2 style={S.h2}>Round Complete</h2>
        <div style={{ ...S.card, background: "#f0fdf4", border: "1px solid #86efac", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
          <strong style={{ fontSize: 16 }}>{savedCount} audit records saved.</strong>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#166534" }}>
            {doneIssues.length === 0
              ? "No discrepancies or issues. All stocks clean."
              : `${doneIssues.length} issue${doneIssues.length > 1 ? "s" : ""} noted and recorded.`}
          </p>
        </div>
        {doneIssues.length > 0 && (
          <div style={S.card}>
            <h3 style={S.h3}>Issues Recorded</h3>
            <table style={S.tbl}>
              <thead><tr>{["Stock","Drug","Issue","Detail"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {doneIssues.map((iss, i) => (
                  <tr key={i}>
                    <td style={S.td}>{iss.stock}</td>
                    <td style={S.td}>{iss.drug} {iss.conc}</td>
                    <td style={S.td}>
                      <span style={S.pill(false)}>
                        {iss.type === "count" ? "Count" : iss.type === "seal" ? "Seal" : "Condition"}
                      </span>
                    </td>
                    <td style={S.td}>
                      {iss.type === "count"
                        ? `Expected ${iss.expected}, counted ${iss.counted}`
                        : iss.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button style={S.btnPrimary} onClick={resetWizard}>Start New Round</button>
      </div>
    );
  }

  // ── Review ────────────────────────────────────────────────────────────────────
  if (step === "review") {
    const issues = collectIssues(results);
    return (
      <div style={S.page}>
        <h2 style={S.h2}>Review &amp; Complete</h2>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
          Lead: <strong>{auditor}</strong> · Witness: <strong>{witness}</strong>
        </p>
        {err && <div style={S.errBox}>{err}</div>}
        {stocks.map((stock, si) => {
          const drugs       = inv[stock] || [];
          const stockIssues = drugs.filter(d => {
            const r = results[si]?.[d.id];
            if (!r) return false;
            const counted = parseFloat(r.counted);
            return (!isNaN(counted) && counted !== parseFloat(d.qty))
              || r.seal !== "intact" || r.condition !== "good";
          });
          return (
            <div key={stock} style={{ ...S.card,
              borderLeft: `4px solid ${stockIssues.length > 0 ? "#f59e0b" : "#22c55e"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 15 }}>{stock}</strong>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={S.pill(stockIssues.length === 0)}>
                    {stockIssues.length === 0 ? "All Clear" : `${stockIssues.length} Issue${stockIssues.length > 1 ? "s" : ""}`}
                  </span>
                  <button style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4,
                    border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", color: "#475569" }}
                    onClick={() => setStep(si)}>Edit</button>
                </div>
              </div>
              {stockIssues.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#92400e" }}>
                  {stockIssues.map(d => d.drug).join(", ")}
                </div>
              )}
            </div>
          );
        })}
        <div style={S.card}>
          <label style={S.label}>Round Notes (optional)
            <textarea style={S.textarea} value={roundNotes}
              onChange={e => setRoundNotes(e.target.value)}
              placeholder="Any additional observations for this round…" />
          </label>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ ...S.btnPrimary, background: "#64748b" }}
            onClick={() => setStep(stocks.length - 1)}>← Back</button>
          <button style={S.btnPrimary} disabled={submitting} onClick={completeRound}>
            {submitting ? "Saving…" : `Complete Round — Save ${stocks.length} Audits`}
          </button>
        </div>
      </div>
    );
  }

  // ── Start ─────────────────────────────────────────────────────────────────────
  if (step === "start") {
    return (
      <div style={S.page}>
        <h2 style={S.h2}>Weekly Round</h2>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
          Guided inspection of all {stocks.length} stock locations in one session.
          Counts are pre-filled from the current inventory — only change what differs physically.
          Completing the round saves one audit record per stock.
        </p>
        <div style={S.card}>
          <h3 style={S.h3}>Round Details</h3>
          <div style={S.form3}>
            <label style={S.label}>Round Lead (Auditor)
              <input style={S.input} value={auditor}
                onChange={e => setAuditor(e.target.value)} />
            </label>
            <label style={S.label}>Witness
              <input style={S.input} value={witness}
                onChange={e => setWitness(e.target.value)} placeholder="Required" />
            </label>
          </div>
          <button style={{ ...S.btnPrimary, marginTop: 16, opacity: (!auditor || !witness) ? 0.5 : 1 }}
            disabled={!auditor || !witness}
            onClick={() => setStep(0)}>
            Begin Round — {stocks.length} Stocks →
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
          {stocks.map((s, i) => (
            <div key={s} style={{ ...S.card, textAlign: "center", padding: 16 }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>{i === 0 ? "🔒" : "🚑"}</div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{s}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                {(inv[s] || []).length} drug{(inv[s] || []).length !== 1 ? "s" : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Stock inspection step ─────────────────────────────────────────────────────
  const si    = step;
  const stock = stocks[si];
  const drugs = inv[stock] || [];
  const isLast = si === stocks.length - 1;

  return (
    <div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h2 style={{ ...S.h2, margin: 0 }}>{stock}</h2>
        <span style={{ fontSize: 13, color: "#64748b" }}>Step {si + 1} of {stocks.length}</span>
      </div>
      <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3, marginBottom: 20 }}>
        <div style={{ height: "100%", borderRadius: 3, background: "#38bdf8",
          width: `${((si + 1) / stocks.length) * 100}%`, transition: "width 0.3s" }} />
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      <div style={S.card}>
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 14px" }}>
          Counts are pre-filled. Change only what differs from the physical safe.
        </p>
        <table style={S.tbl}>
          <thead>
            <tr>
              {["Drug","Conc","Expected","Physical Count","Match","Seal","Condition"].map(h =>
                <th key={h} style={S.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {drugs.length === 0 && (
              <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>
                No drugs in this stock.
              </td></tr>
            )}
            {drugs.map(d => {
              const r      = results[si]?.[d.id] || { counted: String(d.qty), seal: "intact", condition: "good" };
              const counted = parseFloat(r.counted);
              const match  = !isNaN(counted) && counted === parseFloat(d.qty);
              const sealOk = r.seal === "intact";
              const condOk = r.condition === "good";
              return (
                <tr key={d.id} style={{ background: (r.counted !== "" && !match) || !sealOk || !condOk ? "#fff7ed" : "" }}>
                  <td style={S.td}><strong>{d.drug}</strong></td>
                  <td style={S.td}>{d.conc}</td>
                  <td style={S.td}><strong>{d.qty}</strong> {d.unit}</td>
                  <td style={S.td}>
                    <input style={{ ...S.input, width: 80 }} type="number" min="0" step="0.01"
                      value={r.counted}
                      onChange={e => setField(si, d.id, "counted", e.target.value)} />
                  </td>
                  <td style={S.td}>
                    {r.counted !== "" && <span style={S.pill(match)}>{match ? "✓" : "DISC"}</span>}
                  </td>
                  <td style={S.td}>
                    <select style={{ ...S.select, width: 100,
                      background: sealOk ? "#f0fdf4" : "#fef2f2",
                      color:      sealOk ? "#166534" : "#dc2626" }}
                      value={r.seal}
                      onChange={e => setField(si, d.id, "seal", e.target.value)}>
                      <option value="intact">Intact</option>
                      <option value="broken">Broken</option>
                      <option value="missing">Missing</option>
                    </select>
                  </td>
                  <td style={S.td}>
                    <select style={{ ...S.select, width: 110,
                      background: condOk ? "#f0fdf4" : "#fef2f2",
                      color:      condOk ? "#166534" : "#dc2626" }}
                      value={r.condition}
                      onChange={e => setField(si, d.id, "condition", e.target.value)}>
                      <option value="good">Good</option>
                      <option value="damaged">Damaged</option>
                      <option value="expired">Expired</option>
                      <option value="other">Other</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {si > 0 && (
          <button style={{ ...S.btnPrimary, background: "#64748b" }} onClick={() => setStep(si - 1)}>
            ← {stocks[si - 1]}
          </button>
        )}
        <button style={S.btnPrimary} onClick={() => setStep(isLast ? "review" : si + 1)}>
          {isLast ? "Review Round →" : `Next: ${stocks[si + 1]} →`}
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardTab({ user, onNavigate, pendingCount, lowStockItems }) {
  const isAdmin = user.role === "admin";
  const [recent,  setRecent ] = useState([]);
  const [todayCt, setTodayCt] = useState(0);
  const [monthCt, setMonthCt] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/api/administrations?limit=6")
      .then(data => {
        const rows = data.records || [];
        setRecent(rows);
        const today = new Date().toISOString().slice(0, 10);
        setTodayCt(rows.filter(r => (r.created_at || "").slice(0, 10) === today).length);
        setMonthCt(data.total || rows.length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const statCards = [
    ...(isAdmin ? [{
      label: "Pending Review", value: pendingCount,
      color: pendingCount > 0 ? "#ef4444" : "#22c55e",
      bg: pendingCount > 0 ? "#fef2f2" : "#f0fdf4",
      border: pendingCount > 0 ? "#fecaca" : "#bbf7d0",
      action: "pending",
    }] : []),
    {
      label: "Low Stock", value: lowStockItems.length,
      color: lowStockItems.length > 0 ? "#f59e0b" : "#22c55e",
      bg: lowStockItems.length > 0 ? "#fffbeb" : "#f0fdf4",
      border: lowStockItems.length > 0 ? "#fcd34d" : "#bbf7d0",
      action: "inventory",
    },
    { label: "Today's Admins", value: todayCt, color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe", action: "admin-log" },
    { label: "Month Total",    value: monthCt, color: "#8b5cf6", bg: "#f5f3ff", border: "#ddd6fe", action: "admin-log" },
  ];

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ marginBottom: 26 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>
          {greeting}, {user.name.split(" ")[0]}
        </h1>
        <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
          {user.agency_name || "NarcTrack EMS"} · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 14, marginBottom: 26 }}>
        {statCards.map((c, i) => (
          <div key={i} onClick={() => onNavigate(c.action)}
            style={{ background: c.bg, borderRadius: 10, padding: "18px 20px", cursor: "pointer",
                     boxShadow: "0 1px 3px rgba(0,0,0,.05)", border: `1px solid ${c.border}` }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.value}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
        <button onClick={() => onNavigate("log-admin")}
          style={{ ...S.btnPrimary, padding: "11px 22px", fontSize: 14, borderRadius: 8 }}>
          💉 Log Drug Administration
        </button>
        {isAdmin && pendingCount > 0 && (
          <button onClick={() => onNavigate("pending")}
            style={{ ...S.btnPrimary, background: "#ef4444", padding: "11px 22px", fontSize: 14, borderRadius: 8 }}>
            ⏳ Review {pendingCount} Pending
          </button>
        )}
        {isAdmin && lowStockItems.length > 0 && (
          <button onClick={() => onNavigate("transfers")}
            style={{ ...S.btnPrimary, background: "#f59e0b", padding: "11px 22px", fontSize: 14, borderRadius: 8 }}>
            📦 Restock Transfer
          </button>
        )}
      </div>

      {/* Bottom two-col */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>

        {/* Recent administrations */}
        <div style={S.card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ ...S.h3, margin: 0 }}>Recent Administrations</h3>
            <button onClick={() => onNavigate("admin-log")}
              style={{ ...S.btn, background: "#f1f5f9", color: "#64748b", padding: "5px 10px", fontSize: 12 }}>
              View all →
            </button>
          </div>
          {loading ? <div style={S.loading}>Loading…</div> : recent.length === 0 ? (
            <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>No records yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {recent.map(r => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>💉</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>{r.drug} <span style={{ fontWeight: 400, color: "#64748b" }}>{r.dose}</span></div>
                    <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.patient_name} · {r.provider_name}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{new Date(r.created_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stock status */}
        <div style={S.card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ ...S.h3, margin: 0 }}>Stock Status</h3>
            {isAdmin && <button onClick={() => onNavigate("inventory")}
              style={{ ...S.btn, background: "#f1f5f9", color: "#64748b", padding: "5px 10px", fontSize: 12 }}>
              Inventory →
            </button>}
          </div>
          {lowStockItems.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>✅</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#166534" }}>All levels OK</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>No items below minimum</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lowStockItems.map(item => (
                <div key={item.id} style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#92400e" }}>{item.drug} — {item.stock}</div>
                    <div style={{ fontSize: 12, color: "#b45309" }}>{item.qty} {item.unit} remaining · min {item.min_qty}</div>
                  </div>
                </div>
              ))}
              {isAdmin && (
                <button onClick={() => onNavigate("transfers")}
                  style={{ ...S.btn, background: "#f59e0b", color: "#fff", fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                  Initiate Transfer →
                </button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Default tab configuration (used when agency has no custom tab_config) ────
const DEFAULT_TAB_CONFIG = [
  { id: "inventory",    label: "Inventory",          icon: "📦", adminOnly: true,  visible: true },
  { id: "log-admin",    label: "Log Administration", icon: "💉", adminOnly: false, visible: true },
  { id: "pending",      label: "Pending",            icon: "⏳", adminOnly: true,  visible: true },
  { id: "admin-log",    label: "Admin Log",          icon: "📋", adminOnly: false, visible: true },
  { id: "purchases",    label: "Purchases",          icon: "🛒", adminOnly: true,  visible: true },
  { id: "transfers",    label: "Transfers",          icon: "🔄", adminOnly: false, visible: true },
  { id: "waste",        label: "Waste",              icon: "🗑️", adminOnly: false, visible: true },
  { id: "audits",       label: "Audits",             icon: "🔍", adminOnly: false, visible: true },
  { id: "weekly-round", label: "Weekly Round",       icon: "🗓️", adminOnly: true,  visible: true },
  { id: "monthly-logs", label: "Monthly Logs",       icon: "📅", adminOnly: true,  visible: true },
  { id: "exports",      label: "DOH Exports",        icon: "📤", adminOnly: true,  visible: true },
  { id: "users",        label: "Users",              icon: "👥", adminOnly: true,  visible: true },
  { id: "agency-settings", label: "Agency Settings",  icon: "⚙️", adminOnly: true,  visible: true },
  { id: "profile",         label: "My Profile",        icon: "👤", adminOnly: false, visible: true },
];

// ─── Main App Shell ───────────────────────────────────────────────────────────
function MainApp({ user, onLogout }) {
  const isAdmin  = user.role === "admin";
  const navColor = user.agency_nav || "#0f172a";

  const [navAvatarSrc, setNavAvatarSrc] = useState(null);
  useEffect(() => {
    api("/api/users/me").then(u => setNavAvatarSrc(u.avatar || null)).catch(() => {});
  }, []);

  const [lowStockItems, setLowStockItems] = useState([]);
  const [pendingCount,  setPendingCount ] = useState(0);

  const refreshAlerts = useCallback(() => {
    api("/api/inventory/alerts").then(setLowStockItems).catch(() => {});
    if (isAdmin) api("/api/pending").then(r => setPendingCount(r.length)).catch(() => {});
  }, [isAdmin]);
  useEffect(() => { refreshAlerts(); }, [refreshAlerts]);

  const [tab, setTab] = useState("dashboard");

  // Sidebar nav groups — no tab config complexity; admin visibility handled inline
  const navGroups = [
    {
      items: [
        { id: "dashboard", label: "Dashboard", icon: "⌂" },
      ],
    },
    {
      label: "Daily",
      items: [
        { id: "log-admin", label: "Log Drug",  icon: "💉" },
        ...(isAdmin ? [{ id: "pending", label: "Review", icon: "⏳", badge: pendingCount || null }] : []),
      ],
    },
    {
      label: "Records",
      items: [
        { id: "admin-log", label: "Admin Log", icon: "📋" },
        ...(isAdmin ? [{ id: "inventory", label: "Inventory", icon: "📦" }] : []),
      ],
    },
    ...(isAdmin ? [{
      label: "Operations",
      items: [
        { id: "purchases",  label: "Purchases",  icon: "🛒" },
        { id: "transfers",  label: "Transfers",  icon: "🔄" },
        { id: "waste",      label: "Waste",      icon: "🗑️" },
        { id: "audits",     label: "Audits",     icon: "🔍" },
      ],
    }] : []),
    ...(isAdmin ? [{
      label: "Reports",
      items: [
        { id: "weekly-round", label: "Weekly Round", icon: "🗓️" },
        { id: "monthly-logs", label: "Monthly Logs", icon: "📅" },
        { id: "exports",      label: "DOH Exports",  icon: "📤" },
      ],
    }] : []),
    {
      label: "Settings",
      items: [
        ...(isAdmin ? [
          { id: "users",           label: "Users",   icon: "👥" },
          { id: "agency-settings", label: "Agency",  icon: "⚙️" },
        ] : []),
        { id: "profile", label: "My Profile", icon: "👤" },
      ],
    },
  ].filter(g => g.items.length > 0);

  const renderTab = () => {
    switch (tab) {
      case "dashboard":       return <DashboardTab user={user} onNavigate={setTab} pendingCount={pendingCount} lowStockItems={lowStockItems} />;
      case "inventory":       return <InventoryTab user={user} />;
      case "log-admin":       return <LogAdminTab  user={user} onStockChange={refreshAlerts} />;
      case "pending":         return <PendingTab   onStockChange={refreshAlerts} user={user} onNavigate={setTab} />;
      case "admin-log":       return <AdminLogTab  user={user} />;
      case "purchases":       return <PurchasesTab user={user} />;
      case "transfers":       return <TransfersTab user={user} />;
      case "waste":           return <WasteTab     user={user} />;
      case "audits":          return <AuditsTab    user={user} />;
      case "weekly-round":    return <WeeklyRoundTab  user={user} />;
      case "monthly-logs":    return <MonthlyLogsTab  user={user} />;
      case "exports":         return <ExportsTab user={user} />;
      case "users":           return <UsersTab currentUser={user} />;
      case "agency-settings": return <AgencySettingsTab />;
      case "profile":         return <ProfileTab user={user} onAvatarUpdate={setNavAvatarSrc} />;
      default:                return null;
    }
  };

  return (
    <div style={S.appShell}>

      {/* ── Sidebar ── */}
      <aside style={S.sidebar(navColor)}>

        {/* Agency name */}
        <div style={S.sidebarTop}>
          <div style={S.sidebarLogo}>
            <span style={{ fontSize: 20 }}>🚑</span>
            <div style={{ minWidth: 0 }}>
              <div style={S.sidebarTitle}>{user.agency_name || "NarcTrack EMS"}</div>
              <div style={S.sidebarSub}>§80.136 Compliant</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={S.sidebarNav}>
          {navGroups.map((group, gi) => (
            <div key={gi}>
              {group.label && <div style={S.sidebarSec}>{group.label}</div>}
              {group.items.map(item => (
                <button key={item.id} style={S.sidebarItem(tab === item.id)} onClick={() => setTab(item.id)}>
                  <span style={{ fontSize: 14, lineHeight: 1, width: 16, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.badge ? (
                    <span style={{ background: "#ef4444", color: "#fff", borderRadius: 20, fontSize: 10, fontWeight: 700, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div style={S.sidebarFoot}>
          {navAvatarSrc ? (
            <img src={navAvatarSrc} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
          ) : (
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(59,130,246,.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#93c5fd", fontWeight: 700, flexShrink: 0 }}>
              {(user.name?.[0] || "?").toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.sidebarName}>{user.name}</div>
            <div style={S.sidebarRole(user.role)}>{user.role}</div>
          </div>
          <button onClick={onLogout} title="Sign out"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#475569", fontSize: 18, padding: 4, lineHeight: 1, flexShrink: 0 }}>
            ↩
          </button>
        </div>
      </aside>

      {/* ── Content ── */}
      <main style={S.main}>
        {lowStockItems.length > 0 && (
          <div style={{ background: "#7f1d1d", color: "#fef2f2", padding: "9px 24px", display: "flex", alignItems: "center", gap: 10, fontSize: 13, flexShrink: 0 }}>
            <span>⚠️</span>
            <span style={{ flex: 1 }}>
              <strong>Stock Alert: </strong>
              {lowStockItems.map((item, i) => (
                <span key={item.id}>{i > 0 && " · "}<strong>{item.stock}</strong>: {item.drug} — {item.qty} {item.unit} left</span>
              ))}
            </span>
            {isAdmin && (
              <button onClick={() => setTab("transfers")}
                style={{ background: "#fef2f2", border: "none", color: "#7f1d1d", padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontWeight: 600, fontSize: 12, flexShrink: 0 }}>
                Transfer Now
              </button>
            )}
          </div>
        )}
        {renderTab()}
      </main>

    </div>
  );
}

// ─── System Admin Login Page — /sysadmin ─────────────────────────────────────
function SysAdminLoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [err,  setErr ] = useState("");
  const [busy, setBusy] = useState(false);
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const res  = await fetch(`${API}/api/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form), // no agency_id
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Login failed");
      if (body.role !== "sysadmin") throw new Error("This login is for system administrators only.");
      saveToken(body.token);
      onLogin(decodeJwt(body.token));
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...S.loginWrap, background: "#0a0f1e" }}>
      <div style={{ ...S.loginCard, border: "2px solid #6366f1" }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 36 }}>🛡️</span>
        </div>
        <h1 style={{ ...S.loginTitle, color: "#6366f1" }}>System Admin</h1>
        <p style={S.loginSub}>NarcTrack Platform Management</p>
        {err && <div style={S.errBox}>{err}</div>}
        <form onSubmit={submit}>
          <input style={S.loginInput} placeholder="Username" value={form.username} onChange={f("username")} required autoFocus />
          <input style={S.loginInput} type="password" placeholder="Password" value={form.password} onChange={f("password")} required />
          <button style={{ ...S.loginBtn, background: "#6366f1" }} type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign In as System Admin"}
          </button>
        </form>
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <a href="/login" style={{ fontSize: 12, color: "#6366f1" }}>← Back to agency login</a>
        </div>
      </div>
    </div>
  );
}

// ─── System Admin Dashboard ───────────────────────────────────────────────────
function SysAdminApp({ user, onLogout }) {
  const [panel, setPanel] = useState("agencies");

  const navStyle = { background: "#0f0a2e", color: "#fff", padding: "0 20px",
                     display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" };
  const tabStyle = active => ({ padding: "13px 14px", cursor: "pointer", border: "none",
                                background: "none", color: active ? "#a5b4fc" : "#94a3b8",
                                borderBottom: active ? "2px solid #a5b4fc" : "2px solid transparent",
                                fontWeight: active ? 600 : 400, fontSize: 13 });
  return (
    <div style={S.app}>
      <nav style={navStyle}>
        <span style={{ ...S.navTitle, color: "#a5b4fc" }}>🛡️ NarcTrack System Admin</span>
        {[["agencies","🏢 Agencies"],["users","👥 All Users"]].map(([id, label]) => (
          <button key={id} style={tabStyle(panel === id)} onClick={() => setPanel(id)}>{label}</button>
        ))}
        <div style={S.navUser}>
          <span style={{ color: "#a5b4fc", fontWeight: 600 }}>{user.name}</span>
          <button style={S.logoutBtn} onClick={onLogout}>Sign Out</button>
        </div>
      </nav>
      <div style={S.page}>
        {panel === "agencies" && <SysAdminAgencies />}
        {panel === "users"    && <SysAdminUsers />}
      </div>
    </div>
  );
}

// ─── Sys Admin: Agencies Panel ────────────────────────────────────────────────
function SysAdminAgencies() {
  const [agencies,  setAgencies ] = useState([]);
  const [loading,   setLoading  ] = useState(true);
  const [showNew,   setShowNew  ] = useState(false);
  const [expandId,  setExpandId ] = useState(null);
  const [err,       setErr      ] = useState("");
  const [msg,       setMsg      ] = useState("");

  const blankNew = () => ({ name:"", slug:"", primary_color:"#3b82f6",
                             nav_color:"#1e293b", accent_color:"#38bdf8",
                             stocks:["Main Stock","Sub-Stock 1"] });
  const [newForm, setNewForm] = useState(blankNew());

  const load = useCallback(async () => {
    setLoading(true);
    try { setAgencies(await api("/api/sysadmin/agencies")); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createAgency(e) {
    e.preventDefault(); setErr("");
    try {
      await api("/api/sysadmin/agencies", { method: "POST", body: JSON.stringify(newForm) });
      setMsg("Agency created."); setShowNew(false); setNewForm(blankNew()); load();
    } catch (ex) { setErr(ex.message); }
  }

  async function deleteAgency(ag) {
    if (!window.confirm(`Delete "${ag.name}"? This cannot be undone.`)) return;
    try { await api(`/api/sysadmin/agencies/${ag.id}`, { method: "DELETE" }); setMsg("Agency deleted."); load(); }
    catch (ex) { setErr(ex.message); }
  }

  const fNew = k => e => setNewForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div>
      <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={S.h2}>Agencies</h2>
        <button style={{ ...S.btnPrimary, background: "#6366f1" }} onClick={() => setShowNew(v => !v)}>
          + New Agency
        </button>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}

      {showNew && (
        <div style={{ ...S.card, border: "2px solid #6366f1" }}>
          <h3 style={{ ...S.h3, color: "#6366f1" }}>Create New Agency</h3>
          <form onSubmit={createAgency} style={S.form3}>
            <label style={S.label}>Agency Name<input style={S.input} value={newForm.name} onChange={fNew("name")} required /></label>
            <label style={S.label}>Slug (URL-safe ID)<input style={S.input} value={newForm.slug} onChange={fNew("slug")} placeholder="e.g. my-ems-agency" required /></label>
            <label style={S.label}>Stock Locations
              <input style={S.input} value={newForm.stocks.join(", ")}
                onChange={e => setNewForm(p => ({ ...p, stocks: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))}
                placeholder="Main Stock, Sub-Stock 1" />
            </label>
            <label style={S.label}>Nav Color<input type="color" style={{ ...S.input, height: 38, padding: 2 }} value={newForm.nav_color} onChange={fNew("nav_color")} /></label>
            <label style={S.label}>Primary Color<input type="color" style={{ ...S.input, height: 38, padding: 2 }} value={newForm.primary_color} onChange={fNew("primary_color")} /></label>
            <label style={S.label}>Accent Color<input type="color" style={{ ...S.input, height: 38, padding: 2 }} value={newForm.accent_color} onChange={fNew("accent_color")} /></label>
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 8 }}>
              <button style={{ ...S.btnPrimary, background: "#6366f1" }} type="submit">Create</button>
              <button style={{ ...S.btn, background: "#e2e8f0", color: "#475569" }} type="button" onClick={() => setShowNew(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
          {agencies.map(ag => (
            <AgencyCard key={ag.id} agency={ag} expanded={expandId === ag.id}
              onToggle={() => setExpandId(expandId === ag.id ? null : ag.id)}
              onSaved={() => { setMsg(`${ag.name} updated.`); load(); }}
              onDelete={() => deleteAgency(ag)}
              onErr={setErr} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Agency Card (expandable editor) ─────────────────────────────────────────
function AgencyCard({ agency, expanded, onToggle, onSaved, onDelete, onErr }) {
  const [form, setForm] = useState({
    name:          agency.name,
    slug:          agency.slug,
    nav_color:     agency.nav_color,
    primary_color: agency.primary_color,
    accent_color:  agency.accent_color,
    stocks:        Array.isArray(agency.stocks) ? agency.stocks : JSON.parse(agency.stocks || "[]"),
    tab_config:    agency.tab_config || DEFAULT_TAB_CONFIG,
  });
  const [busy,    setBusy   ] = useState(false);
  const [newStock, setNewStock] = useState("");
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  // Keep form in sync when agency prop updates
  useEffect(() => {
    setForm({
      name:          agency.name,
      slug:          agency.slug,
      nav_color:     agency.nav_color,
      primary_color: agency.primary_color,
      accent_color:  agency.accent_color,
      stocks:        Array.isArray(agency.stocks) ? agency.stocks : JSON.parse(agency.stocks || "[]"),
      tab_config:    agency.tab_config || DEFAULT_TAB_CONFIG,
    });
  }, [agency]);

  async function save(e) {
    e.preventDefault(); setBusy(true); onErr("");
    try {
      await api(`/api/sysadmin/agencies/${agency.id}`, { method: "PATCH", body: JSON.stringify(form) });
      onSaved();
    } catch (ex) { onErr(ex.message); }
    finally { setBusy(false); }
  }

  // ── Tab config helpers ──
  const moveTab = (idx, dir) => {
    const tc = [...form.tab_config];
    const swap = idx + dir;
    if (swap < 0 || swap >= tc.length) return;
    [tc[idx], tc[swap]] = [tc[swap], tc[idx]];
    setForm(p => ({ ...p, tab_config: tc }));
  };
  const updateTab = (idx, key, val) => {
    const tc = form.tab_config.map((t, i) => i === idx ? { ...t, [key]: val } : t);
    setForm(p => ({ ...p, tab_config: tc }));
  };

  // ── Stock helpers ──
  const addStock = () => {
    const s = newStock.trim();
    if (!s || form.stocks.includes(s)) return;
    setForm(p => ({ ...p, stocks: [...p.stocks, s] }));
    setNewStock("");
  };
  const removeStock = s => setForm(p => ({ ...p, stocks: p.stocks.filter(x => x !== s) }));

  const previewNav = { background: form.nav_color, color: "#fff", padding: "8px 14px",
                        borderRadius: 6, marginBottom: 12, display: "flex", alignItems: "center",
                        gap: 8, fontSize: 13, fontWeight: 600 };

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: agency.nav_color, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{agency.name}</div>
          <div style={{ color: "rgba(255,255,255,.6)", fontSize: 11, marginTop: 2 }}>
            {agency.user_count} user{agency.user_count !== 1 ? "s" : ""} · {agency.admin_count} admin{agency.admin_count !== 1 ? "s" : ""}
          </div>
        </div>
        <span style={{ display: "flex", gap: 6 }}>
          <button style={{ ...S.btnGray, fontSize: 11 }} onClick={onToggle}>
            {expanded ? "▲ Collapse" : "✏️ Edit"}
          </button>
          <button style={{ ...S.btnDanger, fontSize: 11 }} onClick={onDelete}>🗑️</button>
        </span>
      </div>

      {/* Color preview strip */}
      <div style={{ display: "flex", height: 6 }}>
        <div style={{ flex: 1, background: agency.nav_color }} />
        <div style={{ flex: 1, background: agency.primary_color }} />
        <div style={{ flex: 1, background: agency.accent_color }} />
      </div>

      {expanded && (
        <form onSubmit={save} style={{ padding: 16 }}>
          {/* Live color preview */}
          <div style={previewNav}>
            <span>🚑</span>
            <span>{form.name || "Agency Name"}</span>
            <span style={{ marginLeft: "auto", color: form.accent_color, fontSize: 11 }}>◉ active tab</span>
          </div>

          {/* ── Identity ── */}
          <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#475569" }}>Identity</h4>
          <div style={S.form2}>
            <label style={S.label}>Agency Name<input style={S.input} value={form.name} onChange={f("name")} required /></label>
            <label style={S.label}>Slug<input style={S.input} value={form.slug} onChange={f("slug")} /></label>
          </div>

          {/* ── Colors ── */}
          <h4 style={{ margin: "12px 0 8px", fontSize: 13, color: "#475569" }}>Colors</h4>
          <div style={S.form3}>
            <label style={S.label}>
              Nav Bar
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="color" style={{ width: 40, height: 32, border: "1px solid #cbd5e1", borderRadius: 4, padding: 2, cursor: "pointer" }}
                  value={form.nav_color} onChange={f("nav_color")} />
                <input style={{ ...S.input, flex: 1, fontFamily: "monospace" }} value={form.nav_color} onChange={f("nav_color")} maxLength={7} />
              </span>
            </label>
            <label style={S.label}>
              Primary
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="color" style={{ width: 40, height: 32, border: "1px solid #cbd5e1", borderRadius: 4, padding: 2, cursor: "pointer" }}
                  value={form.primary_color} onChange={f("primary_color")} />
                <input style={{ ...S.input, flex: 1, fontFamily: "monospace" }} value={form.primary_color} onChange={f("primary_color")} maxLength={7} />
              </span>
            </label>
            <label style={S.label}>
              Accent (active tabs)
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="color" style={{ width: 40, height: 32, border: "1px solid #cbd5e1", borderRadius: 4, padding: 2, cursor: "pointer" }}
                  value={form.accent_color} onChange={f("accent_color")} />
                <input style={{ ...S.input, flex: 1, fontFamily: "monospace" }} value={form.accent_color} onChange={f("accent_color")} maxLength={7} />
              </span>
            </label>
          </div>

          {/* ── Stock locations ── */}
          <h4 style={{ margin: "12px 0 8px", fontSize: 13, color: "#475569" }}>Stock Locations</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {form.stocks.map(s => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 20, padding: "3px 10px", fontSize: 12 }}>
                {s}
                <button type="button" onClick={() => removeStock(s)}
                  style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            <input style={{ ...S.input, flex: 1 }} value={newStock} onChange={e => setNewStock(e.target.value)}
              placeholder="New stock name…" onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addStock())} />
            <button type="button" style={S.btnPrimary} onClick={addStock}>Add</button>
          </div>

          {/* ── Tab configuration ── */}
          <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#475569" }}>Tab Configuration</h4>
          <div style={{ background: "#f8fafc", borderRadius: 6, padding: 8, marginBottom: 16 }}>
            {form.tab_config.map((t, idx) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px",
                                       background: t.visible ? "#fff" : "#f8fafc",
                                       border: "1px solid #e2e8f0", borderRadius: 4, marginBottom: 4 }}>
                {/* Visibility toggle */}
                <input type="checkbox" checked={t.visible !== false} style={{ cursor: "pointer" }}
                  onChange={e => updateTab(idx, "visible", e.target.checked)} title="Visible" />
                {/* Icon */}
                <input style={{ ...S.input, width: 40, textAlign: "center", padding: "3px", fontSize: 16 }}
                  value={t.icon || ""} onChange={e => updateTab(idx, "icon", e.target.value)}
                  title="Emoji icon" maxLength={2} />
                {/* Label */}
                <input style={{ ...S.input, flex: 1 }} value={t.label}
                  onChange={e => updateTab(idx, "label", e.target.value)} />
                {/* Admin-only toggle */}
                <label style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", display: "flex", gap: 3, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={t.adminOnly === true}
                    onChange={e => updateTab(idx, "adminOnly", e.target.checked)} />
                  Admin only
                </label>
                {/* Reorder */}
                <button type="button" style={{ ...S.btn, padding: "2px 6px", background: "#e2e8f0", color: "#475569", fontSize: 12 }}
                  onClick={() => moveTab(idx, -1)} disabled={idx === 0}>▲</button>
                <button type="button" style={{ ...S.btn, padding: "2px 6px", background: "#e2e8f0", color: "#475569", fontSize: 12 }}
                  onClick={() => moveTab(idx, 1)} disabled={idx === form.tab_config.length - 1}>▼</button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...S.btnPrimary, background: "#6366f1" }} type="submit" disabled={busy}>
              {busy ? "Saving…" : "💾 Save Changes"}
            </button>
            <button type="button" style={{ ...S.btn, background: "#e2e8f0", color: "#475569" }} onClick={onToggle}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Sys Admin: All Users Panel ───────────────────────────────────────────────
function SysAdminUsers() {
  const [users,    setUsers   ] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [err,      setErr     ] = useState("");
  const [msg,      setMsg     ] = useState("");
  const [filter,   setFilter  ] = useState("");
  // expanded user id for the add-to-agency panel
  const [expanded,  setExpanded ] = useState(null);
  // per-expanded-user form state
  const [addForm,   setAddForm  ] = useState({ agency_id: "", role: "user", badge: "" });
  // password reset form (keyed by user id)
  const [resetPwId, setResetPwId] = useState(null);
  const [resetPw,   setResetPw  ] = useState({ pw: "", pw2: "" });

  useEffect(() => {
    Promise.all([
      api("/api/sysadmin/users"),
      api("/api/sysadmin/agencies"),
    ])
      .then(([u, a]) => { setUsers(u); setAgencies(a); })
      .catch(ex => setErr(ex.message))
      .finally(() => setLoading(false));
  }, []);

  function openExpand(userId) {
    if (expanded === userId) { setExpanded(null); setResetPwId(null); return; }
    setExpanded(userId);
    setAddForm({ agency_id: "", role: "user", badge: "" });
    setResetPwId(null);
    setResetPw({ pw: "", pw2: "" });
  }

  async function sysResetPassword(u, e) {
    e.preventDefault(); setErr("");
    if (resetPw.pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (resetPw.pw !== resetPw.pw2) { setErr("Passwords do not match."); return; }
    try {
      await api(`/api/sysadmin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ password: resetPw.pw }) });
      setMsg(`Password reset for ${u.name}.`);
      setResetPwId(null); setResetPw({ pw: "", pw2: "" });
    } catch (ex) { setErr(ex.message); }
  }

  async function toggleSysAdmin(u) {
    const isSys = u.global_role === "sysadmin";
    if (!window.confirm(isSys ? `Remove sysadmin from ${u.name}?` : `Grant sysadmin to ${u.name}?`)) return;
    try {
      await api(`/api/sysadmin/users/${u.id}`, { method: "PATCH",
        body: JSON.stringify({ global_role: isSys ? null : "sysadmin" }) });
      setMsg(`${u.name} updated.`);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, global_role: isSys ? null : "sysadmin" } : x));
    } catch (ex) { setErr(ex.message); }
  }

  async function addToAgency(u) {
    if (!addForm.agency_id) { setErr("Select an agency first."); return; }
    try {
      await api(`/api/sysadmin/agencies/${addForm.agency_id}/users`, {
        method: "POST",
        body: JSON.stringify({ user_id: u.id, role: addForm.role, badge: addForm.badge || "UNASSIGNED" }),
      });
      const agName = agencies.find(a => String(a.id) === String(addForm.agency_id))?.name || addForm.agency_id;
      const newMembership = { agency_id: addForm.agency_id, agency_name: agName, role: addForm.role, badge: addForm.badge || "UNASSIGNED" };
      setUsers(prev => prev.map(x => {
        if (x.id !== u.id) return x;
        const filtered = (x.memberships || []).filter(m => String(m.agency_id) !== String(addForm.agency_id));
        return { ...x, memberships: [...filtered, newMembership] };
      }));
      setMsg(`${u.name} added to ${agName}.`);
      setAddForm({ agency_id: "", role: "user", badge: "" });
    } catch (ex) { setErr(ex.message); }
  }

  async function removeFromAgency(u, membership) {
    if (!window.confirm(`Remove ${u.name} from ${membership.agency_name}?`)) return;
    try {
      await api(`/api/sysadmin/agencies/${membership.agency_id}/users/${u.id}`, { method: "DELETE" });
      setUsers(prev => prev.map(x => x.id !== u.id ? x : {
        ...x, memberships: (x.memberships || []).filter(m => String(m.agency_id) !== String(membership.agency_id)),
      }));
      setMsg(`${u.name} removed from ${membership.agency_name}.`);
    } catch (ex) { setErr(ex.message); }
  }

  const filtered = users.filter(u =>
    !filter || (u.name||"").toLowerCase().includes(filter.toLowerCase()) ||
    (u.email||"").toLowerCase().includes(filter.toLowerCase()) ||
    (u.username||"").toLowerCase().includes(filter.toLowerCase())
  );

  const panelStyle = {
    background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
    padding: "14px 16px", marginTop: 8,
  };
  const chipStyle = {
    display: "inline-flex", alignItems: "center", gap: 4,
    marginRight: 4, marginBottom: 4,
    padding: "2px 8px", borderRadius: 10, fontSize: 11,
    background: "#ede9fe", color: "#6d28d9",
  };

  return (
    <div>
      <h2 style={{ ...S.h2, marginBottom: 16 }}>All Users ({users.length})</h2>
      {err && <div style={S.errBox}>{err} <button style={{ marginLeft: 8, fontSize: 11, cursor: "pointer" }} onClick={() => setErr("")}>✕</button></div>}
      {msg && <div style={S.okBox}>{msg} <button style={{ marginLeft: 8, fontSize: 11, cursor: "pointer" }} onClick={() => setMsg("")}>✕</button></div>}
      <input style={{ ...S.input, maxWidth: 320, marginBottom: 16 }} placeholder="Filter by name / email…"
        value={filter} onChange={e => setFilter(e.target.value)} />
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(u => (
            <div key={u.id} style={{ ...S.card, padding: 0, overflow: "hidden" }}>
              {/* ── Header row ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                            flexWrap: "wrap", cursor: "pointer" }}
                   onClick={() => openExpand(u.id)}>
                {/* Avatar placeholder */}
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#818cf8",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: "#fff", fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                  {(u.name || u.username || "?")[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name || "—"}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{u.email || u.username || "—"}</div>
                </div>
                {/* Agency chips */}
                <div style={{ flex: 2, minWidth: 180, display: "flex", flexWrap: "wrap" }}>
                  {(u.memberships||[]).length === 0
                    ? <span style={{ fontSize: 11, color: "#94a3b8" }}>No agencies</span>
                    : (u.memberships||[]).map(m => (
                        <span key={m.agency_id} style={chipStyle}>
                          {m.agency_name} · {m.role}
                        </span>
                      ))
                  }
                </div>
                {/* Sysadmin badge */}
                {u.global_role === "sysadmin" && (
                  <span style={{ fontSize: 12, color: "#6366f1", fontWeight: 700, whiteSpace: "nowrap" }}>🛡️ Sysadmin</span>
                )}
                {/* Expand chevron */}
                <span style={{ fontSize: 16, color: "#94a3b8", marginLeft: "auto", userSelect: "none" }}>
                  {expanded === u.id ? "▲" : "▼"}
                </span>
              </div>

              {/* ── Expanded panel ── */}
              {expanded === u.id && (
                <div style={{ borderTop: "1px solid #e2e8f0", padding: "14px 16px" }}>
                  {/* Current memberships with remove */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Agency Memberships</div>
                    {(u.memberships||[]).length === 0
                      ? <span style={{ fontSize: 12, color: "#94a3b8" }}>Not assigned to any agency.</span>
                      : (u.memberships||[]).map(m => (
                          <div key={m.agency_id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span style={{ ...chipStyle, margin: 0 }}>{m.agency_name}</span>
                            <span style={{ fontSize: 11, color: "#64748b" }}>Role: <strong>{m.role}</strong></span>
                            <span style={{ fontSize: 11, color: "#64748b" }}>Badge: <strong>{m.badge}</strong></span>
                            <button style={{ ...S.btnDanger, fontSize: 11, padding: "2px 8px", marginLeft: 4 }}
                              onClick={() => removeFromAgency(u, m)}>Remove</button>
                          </div>
                        ))
                    }
                  </div>

                  {/* Add to agency form */}
                  <div style={panelStyle}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>➕ Add to Agency</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>Agency</div>
                        <select style={{ ...S.input, minWidth: 160 }} value={addForm.agency_id}
                          onChange={e => setAddForm(f => ({ ...f, agency_id: e.target.value }))}>
                          <option value="">— select —</option>
                          {agencies
                            .filter(a => !(u.memberships||[]).some(m => String(m.agency_id) === String(a.id)))
                            .map(a => <option key={a.id} value={a.id}>{a.name}</option>)
                          }
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>Role</div>
                        <select style={{ ...S.input, minWidth: 100 }} value={addForm.role}
                          onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}>
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>Badge #</div>
                        <input style={{ ...S.input, width: 100 }} placeholder="e.g. 929"
                          value={addForm.badge}
                          onChange={e => setAddForm(f => ({ ...f, badge: e.target.value }))} />
                      </div>
                      <button style={{ ...S.btnPrimary, alignSelf: "flex-end" }}
                        onClick={() => addToAgency(u)}>Add to Agency</button>
                    </div>
                  </div>

                  {/* Password reset */}
                  <div style={{ marginTop: 12 }}>
                    <button style={{ ...S.btnGray, background: "#f59e0b", color: "#fff" }}
                      onClick={() => { setResetPwId(resetPwId === u.id ? null : u.id); setResetPw({ pw: "", pw2: "" }); }}>
                      🔑 {resetPwId === u.id ? "Cancel Password Reset" : "Reset Password"}
                    </button>
                    {resetPwId === u.id && (
                      <form onSubmit={e => sysResetPassword(u, e)}
                        style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end",
                                 marginTop: 10, padding: "12px 14px", background: "#fffbeb",
                                 border: "1px solid #fde68a", borderRadius: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e", width: "100%" }}>
                          Set new password for <strong>{u.name || u.username}</strong>
                        </div>
                        <label style={{ ...S.label, margin: 0 }}>
                          <span style={{ fontSize: 11 }}>New Password</span>
                          <input style={{ ...S.input, width: 180 }} type="password" required minLength={6}
                            placeholder="min 6 characters"
                            value={resetPw.pw} onChange={e => setResetPw(p => ({ ...p, pw: e.target.value }))} />
                        </label>
                        <label style={{ ...S.label, margin: 0 }}>
                          <span style={{ fontSize: 11 }}>Confirm Password</span>
                          <input style={{ ...S.input, width: 180 }} type="password" required
                            placeholder="repeat password"
                            value={resetPw.pw2} onChange={e => setResetPw(p => ({ ...p, pw2: e.target.value }))} />
                        </label>
                        <button type="submit"
                          style={{ ...S.btnPrimary, background: "#f59e0b", alignSelf: "flex-end" }}>
                          Set Password
                        </button>
                      </form>
                    )}
                  </div>

                  {/* Sysadmin toggle */}
                  <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                    <button style={u.global_role === "sysadmin" ? S.btnDanger : S.btnGray}
                      onClick={() => toggleSysAdmin(u)}>
                      {u.global_role === "sysadmin" ? "Revoke Sysadmin 🛡️" : "Grant Sysadmin 🛡️"}
                    </button>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>Sysadmin bypasses all agency restrictions.</span>
                  </div>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13 }}>No users match your filter.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => {
    const token = getToken();
    if (!token) return null;
    const decoded = decodeJwt(token);
    if (!decoded || decoded.exp * 1000 < Date.now()) { clearToken(); return null; }
    return decoded;
  });

  const handleLogin  = decoded => setUser(decoded);
  const handleLogout = ()      => { clearToken(); setUser(null); };

  const isSysAdmin = user?.role === "sysadmin";

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth-callback" element={<AuthCallback />} />
        <Route path="/login" element={
          user ? <Navigate to={isSysAdmin ? "/sysadmin" : "/"} replace /> : <LoginPage onLogin={handleLogin} />
        } />
        <Route path="/sysadmin" element={
          isSysAdmin
            ? <SysAdminApp user={user} onLogout={handleLogout} />
            : user
              ? <Navigate to="/" replace />
              : <SysAdminLoginPage onLogin={decoded => { handleLogin(decoded); }} />
        } />
        <Route path="/" element={
          user && !isSysAdmin
            ? <MainApp user={user} onLogout={handleLogout} />
            : user && isSysAdmin
              ? <Navigate to="/sysadmin" replace />
              : <Navigate to="/login" replace />
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
