// NarcTrack EMS — Frontend
// React 18 + React Router v6, wired to the NarcTrack API
// NYS 10 NYCRR §80.136 Compliant

import { useState, useEffect, useCallback } from "react";
import {
  BrowserRouter, Routes, Route, Navigate,
  useNavigate, useLocation,
} from "react-router-dom";

// ─── Config ───────────────────────────────────────────────────────────────────
const API    = import.meta.env.VITE_API_URL || "http://localhost:3001";
const STOCKS = ["Main Stock", "929", "9299"];
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
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Export failed");
    return;
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
  app:        { fontFamily: "'Segoe UI', sans-serif", minHeight: "100vh", background: "#f1f5f9" },
  nav:        { background: "#1e293b", color: "#fff", padding: "0 20px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" },
  navTitle:   { fontWeight: 700, fontSize: 17, marginRight: 12, padding: "13px 0", whiteSpace: "nowrap" },
  navTab:     a => ({ padding: "13px 12px", cursor: "pointer", border: "none", background: "none", color: a ? "#38bdf8" : "#94a3b8", borderBottom: a ? "2px solid #38bdf8" : "2px solid transparent", fontWeight: a ? 600 : 400, fontSize: 13 }),
  navUser:    { marginLeft: "auto", fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 8, paddingLeft: 8 },
  logoutBtn:  { background: "#ef4444", border: "none", color: "#fff", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12 },
  page:       { padding: 20, maxWidth: 1200, margin: "0 auto" },
  card:       { background: "#fff", borderRadius: 8, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.08)", marginBottom: 16 },
  h2:         { margin: "0 0 16px", fontSize: 20, color: "#1e293b" },
  h3:         { margin: "0 0 14px", fontSize: 15, color: "#334155" },
  tbl:        { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th:         { background: "#f8fafc", padding: "8px 10px", textAlign: "left", borderBottom: "2px solid #e2e8f0", color: "#475569", fontWeight: 600 },
  td:         { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: "#334155" },
  form2:      { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  form3:      { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  label:      { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#475569" },
  input:      { padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 13, outline: "none" },
  select:     { padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 13, background: "#fff" },
  textarea:   { padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 13, minHeight: 60, resize: "vertical" },
  span2:      { gridColumn: "1 / -1" },
  btn:        { padding: "7px 14px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500 },
  btnPrimary: { padding: "8px 18px", borderRadius: 4, border: "none", cursor: "pointer", background: "#3b82f6", color: "#fff", fontWeight: 600, fontSize: 13 },
  btnSuccess: { padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer", background: "#22c55e", color: "#fff", fontSize: 12 },
  btnDanger:  { padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer", background: "#ef4444", color: "#fff", fontSize: 12 },
  btnGray:    { padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer", background: "#64748b", color: "#fff", fontSize: 12 },
  btnExport:  c => ({ padding: "9px 16px", borderRadius: 4, border: "none", cursor: "pointer", background: c || "#0ea5e9", color: "#fff", fontWeight: 600, fontSize: 13 }),
  row:        { display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" },
  filterRow:  { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" },
  errBox:     { background: "#fee2e2", color: "#dc2626", padding: "9px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 },
  okBox:      { background: "#dcfce7", color: "#166534", padding: "9px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 },
  loading:    { padding: 40, textAlign: "center", color: "#64748b" },
  center:     { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontSize: 16, color: "#64748b" },
  pill:       ok => ({ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: ok ? "#dcfce7" : "#fee2e2", color: ok ? "#166534" : "#dc2626" }),
  roleBadge:  r  => ({ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: r === "admin" ? "#ede9fe" : r === "pending" ? "#fef3c7" : "#dbeafe", color: r === "admin" ? "#7c3aed" : r === "pending" ? "#b45309" : "#1d4ed8" }),
  statBox:    { background: "#f8fafc", borderRadius: 6, padding: 14, textAlign: "center" },
  statNum:    { fontSize: 28, fontWeight: 700, color: "#1e293b" },
  statLabel:  { fontSize: 11, color: "#64748b", marginTop: 2 },
  // Login
  loginWrap:  { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" },
  loginCard:  { background: "#fff", borderRadius: 12, padding: 40, width: 360, boxShadow: "0 20px 60px rgba(0,0,0,.35)" },
  loginTitle: { margin: "0 0 4px", fontSize: 26, fontWeight: 700, color: "#1e293b", textAlign: "center" },
  loginSub:   { margin: "0 0 24px", fontSize: 11, color: "#64748b", textAlign: "center" },
  loginInput: { display: "block", width: "100%", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: "border-box" },
  loginBtn:   { display: "block", width: "100%", padding: 11, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 14, cursor: "pointer", marginBottom: 10 },
  googleBtn:  { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: 11, border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer", textDecoration: "none", color: "#334155", gap: 10, boxSizing: "border-box" },
  divider:    { textAlign: "center", color: "#94a3b8", margin: "14px 0", fontSize: 12 },
};

// ─── Auth Callback — /auth-callback ───────────────────────────────────────────
function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get("token");
    const error  = params.get("error");
    if (error === "pending") {
      navigate("/login?msg=" + encodeURIComponent("Account pending role assignment — contact an admin."));
    } else if (error) {
      navigate("/login?msg=" + encodeURIComponent("Google sign-in failed. Try again."));
    } else if (token) {
      saveToken(token);
      navigate("/");
    } else {
      navigate("/login?msg=No+token+received");
    }
  }, [navigate]);
  return <div style={S.center}>Completing sign-in…</div>;
}

// ─── Login Page — /login ──────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [err,  setErr ] = useState("");
  const [busy, setBusy] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const msg = new URLSearchParams(location.search).get("msg");
    if (msg) setErr(msg);
  }, [location.search]);

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      // Use raw fetch so a 401 "Invalid credentials" response shows the
      // error message instead of being caught by the api() 401→redirect handler.
      const res  = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Login failed");
      saveToken(body.token);
      onLogin(decodeJwt(body.token));
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <h1 style={S.loginTitle}>🚑 NarcTrack EMS</h1>
        <p style={S.loginSub}>NYS 10 NYCRR §80.136 Controlled Substance Management</p>
        {err && <div style={S.errBox}>{err}</div>}
        <form onSubmit={submit}>
          <input style={S.loginInput} placeholder="Username or email"
            value={form.username} onChange={f("username")} required autoFocus />
          <input style={S.loginInput} type="password" placeholder="Password"
            value={form.password} onChange={f("password")} required />
          <button style={S.loginBtn} type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <div style={S.divider}>— or —</div>
        <a href={`${API}/api/auth/google`} style={S.googleBtn}>
          {/* Google G logo */}
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
          Sign in with Google
        </a>
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
  const [form, setForm] = useState({
    stock: STOCKS[0], drug: "", conc: "", unit: "mL", qty: "",
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
      setForm({ stock: STOCKS[0], drug: "", conc: "", unit: "mL", qty: "", minQty: 5, manufacturer: "", lot: "", supplier: "", supplierDEA: "" });
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
                {STOCKS.map(s => <option key={s}>{s}</option>)}
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

      {STOCKS.map(stock => (
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
function LogAdminTab({ user }) {
  const availStocks = user.role === "admin" ? STOCKS : STOCKS.filter(s => s !== "Main Stock");
  const blank = () => ({
    stock: availStocks[0], drug: "", conc: "", unit: "",
    doseAmount: "", doseUnit: "mg",
    route: "IV", runId: "", patientName: "", complaint: "",
    providerNum: user.badge || "", providerName: user.name || "",
    mdName: "", mdSig: "", receivingHospital: "", hospitalRecordNum: "",
    witness: "", wasteAmt: "", wasteWitness: "", wasteReason: "",
    confirmPassword: "",
  });
  const [form, setForm] = useState(blank);
  const [inv,  setInv ] = useState({});
  const [err,  setErr ] = useState("");
  const [msg,  setMsg ] = useState("");
  const [busy, setBusy] = useState(false);

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
      await api("/api/pending", { method: "POST", body: JSON.stringify({
        ...form,
        dose:    `${form.doseAmount}${form.doseUnit}`,
        doseQty: String(mlCalc),
      })});
      setMsg("Administration submitted — pending admin verification.");
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
function PendingTab() {
  const [records,   setRecords  ] = useState([]);
  const [loading,   setLoading  ] = useState(true);
  const [err,       setErr      ] = useState("");
  const [noteMap,   setNoteMap  ] = useState({});
  const [reasonMap, setReasonMap] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setRecords(await api("/api/pending")); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function verify(id) {
    try {
      await api(`/api/pending/${id}/verify`, { method: "POST", body: JSON.stringify({ note: noteMap[id] || "" }) });
      load();
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
      {records.length === 0 && <div style={S.card}><p style={{ color: "#64748b", margin: 0 }}>No pending records.</p></div>}
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
            <button style={S.btnSuccess} onClick={() => verify(r.id)}>✓ Verify</button>
            <input style={{ ...S.input, flex: 1, minWidth: 180 }} placeholder="Rejection reason (required)"
              value={reasonMap[r.id] || ""} onChange={e => setReasonMap(p => ({ ...p, [r.id]: e.target.value }))} />
            <button style={S.btnDanger} onClick={() => reject(r.id)}>✕ Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Administration Log Tab ───────────────────────────────────────────────────
function AdminLogTab({ user }) {
  const now = new Date();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr    ] = useState("");
  const [filters, setFilters] = useState({ year: String(now.getFullYear()), month: String(now.getMonth()), stock: "", status: "" });

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

  return (
    <div style={S.page}>
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
              {STOCKS.map(s => <option key={s}>{s}</option>)}
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
                <tr key={r.id}>
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
function PurchasesTab() {
  const now  = new Date();
  const blank = () => ({ stock: STOCKS[0], drug: "", conc: "", unit: "mL", qty: "", supplier: "", supplierDEA: "", manufacturer: "", lot: "", receivedBy: "" });
  const [records,  setRecords ] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm    ] = useState(blank());
  const [err,      setErr     ] = useState("");
  const [msg,      setMsg     ] = useState("");
  const [year,     setYear    ] = useState(String(now.getFullYear()));

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
            <label style={S.label}>Stock<select style={S.select} value={form.stock} onChange={f("stock")} required>{STOCKS.map(s=><option key={s}>{s}</option>)}</select></label>
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
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead><tr>{["Date","Stock","Drug","Conc","Qty","Supplier","DEA #","Manufacturer","Lot","Received By","By"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {records.length === 0 && <tr><td colSpan={11} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No purchases.</td></tr>}
              {records.map(r => (
                <tr key={r.id}>
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
  const availStocks = user.role === "admin" ? STOCKS : STOCKS.filter(s => s !== "Main Stock");
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
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead><tr>{["Date","From","To","Drug","Conc","Qty","Transferred By","Witness","By"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {records.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No transfers.</td></tr>}
              {records.map(r => (
                <tr key={r.id}>
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
  const blank = () => ({ stock: "929", drug: "", conc: "", unit: "", qty: "", reason: "", disposedBy: user.name || "", witness: "", method: "Inactivation Kit" });
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
  const availStocks = user.role === "admin" ? STOCKS : STOCKS.filter(s => s !== "Main Stock");
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
  const auditAvailStocks = user.role === "admin" ? STOCKS : STOCKS.filter(s => s !== "Main Stock");
  const [stock,    setStock   ] = useState(user.role === "admin" ? "Main Stock" : auditAvailStocks[0]);
  const [auditor,  setAuditor ] = useState(user.name || "");
  const [witness,  setWitness ] = useState("");
  const [notes,    setNotes   ] = useState("");
  const [counts,   setCounts  ] = useState({});
  const [err,      setErr     ] = useState("");
  const [msg,      setMsg     ] = useState("");
  const [year,     setYear    ] = useState(String(now.getFullYear()));

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
      drug: d.drug, conc: d.conc, expected: d.qty,
      counted: parseFloat(counts[d.id] ?? 0),
      match: parseFloat(counts[d.id] ?? 0) === parseFloat(d.qty),
    }));
    try {
      await api("/api/audits", { method: "POST", body: JSON.stringify({ stock, auditor, witness, results, notes }) });
      setMsg("Audit saved."); setShowForm(false); setCounts({}); setNotes(""); setWitness(""); load();
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
              <thead><tr>{["Drug","Concentration","Expected","Counted","Match"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {stockDrugs.length === 0 && <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No drugs in this stock.</td></tr>}
                {stockDrugs.map(d => {
                  const counted = parseFloat(counts[d.id] ?? "");
                  const match   = !isNaN(counted) && counted === parseFloat(d.qty);
                  return (
                    <tr key={d.id}>
                      <td style={S.td}>{d.drug}</td>
                      <td style={S.td}>{d.conc}</td>
                      <td style={S.td}><strong>{d.qty}</strong> {d.unit}</td>
                      <td style={S.td}>
                        <input style={{ ...S.input, width: 80 }} type="number" min="0" step="0.01"
                          value={counts[d.id] ?? ""} onChange={e => setCounts(p => ({ ...p, [d.id]: e.target.value }))} />
                      </td>
                      <td style={S.td}>{counts[d.id] !== undefined && <span style={S.pill(match)}>{match ? "MATCH" : "DISCREPANCY"}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <label style={{ ...S.label, marginTop: 12 }}>Notes<textarea style={S.textarea} value={notes} onChange={e => setNotes(e.target.value)} /></label>
            <button style={{ ...S.btnPrimary, marginTop: 12 }} type="submit">Save Audit</button>
          </form>
        </div>
      )}
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead><tr>{["Date","Stock","Auditor","Witness","Result","Notes"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {records.length === 0 && <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", color: "#94a3b8" }}>No audits.</td></tr>}
              {records.map(r => {
                const res = typeof r.results === "string" ? JSON.parse(r.results) : (r.results || []);
                const disc = Array.isArray(res) ? res.filter(x => !x.match).length : 0;
                return (
                  <tr key={r.id}>
                    <td style={S.td}>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td style={S.td}>{r.stock}</td>
                    <td style={S.td}>{r.auditor}</td>
                    <td style={S.td}>{r.witness}</td>
                    <td style={S.td}><span style={S.pill(disc === 0)}>{disc === 0 ? "All Match" : `${disc} Discrepancy`}</span></td>
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
  const [exporting, setExporting] = useState("");

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

  // BUG-007 fix: removed unused `color` parameter
  async function doExport(type) {
    setExporting(type); setErr("");
    try { await downloadExport(`/api/export/${type}?year=${selYear}&month=${selMonth}`); }
    catch (ex) { setErr(ex.message); }
    finally { setExporting(""); }
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

      {/* DOH Export Buttons */}
      <div style={S.card}>
        <h3 style={S.h3}>NYS DOH Exports — {MONTHS[selMonth]} {selYear}</h3>
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>
          Downloads pre-formatted CSV files mapped to NYS DOH form columns. Open in Excel via File → Open → Comma delimited.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button style={S.btnExport("#0ea5e9")} onClick={() => doExport("doh3850")} disabled={!!exporting}>
            {exporting === "doh3850" ? "Generating…" : "⬇ DOH-3850 — Administration Record"}
          </button>
          <button style={S.btnExport("#7c3aed")} onClick={() => doExport("doh3851")} disabled={!!exporting}>
            {exporting === "doh3851" ? "Generating…" : "⬇ DOH-3851 — Inventory / Purchase Record"}
          </button>
          <button style={S.btnExport("#0f766e")} onClick={async () => {
            setExporting("annual"); setErr("");
            try { await downloadExport(`/api/export/annual?year=${selYear}`); }
            catch (ex) { setErr(ex.message); }
            finally { setExporting(""); }
          }} disabled={!!exporting}>
            {exporting === "annual" ? "Generating…" : `⬇ Annual Report — ${selYear}`}
          </button>
        </div>
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
  const blank = () => ({ username: "", email: "", password: "", name: "", badge: "", role: "user" });
  const [users,    setUsers   ] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm    ] = useState(blank());
  const [editId,   setEditId  ] = useState(null);
  const [editData, setEditData] = useState({});
  const [err,      setErr     ] = useState("");
  const [msg,      setMsg     ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await api("/api/users")); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function addUser(e) {
    e.preventDefault();
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      setMsg("User created."); setShowForm(false); setForm(blank()); load();
    } catch (ex) { setErr(ex.message); }
  }

  async function saveEdit(id) {
    try {
      await api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(editData) });
      setMsg("User updated."); setEditId(null); setEditData({}); load();
    } catch (ex) { setErr(ex.message); }
  }

  async function deleteUser(id) {
    if (!window.confirm("Delete this user? This cannot be undone.")) return;
    try {
      await api(`/api/users/${id}`, { method: "DELETE" });
      setMsg("User deleted."); load();
    } catch (ex) { setErr(ex.message); }
  }

  return (
    <div style={S.page}>
      <div style={{ ...S.row, justifyContent: "space-between" }}>
        <h2 style={S.h2}>User Management</h2>
        <button style={S.btnPrimary} onClick={() => setShowForm(v => !v)}>+ Add User</button>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {msg && <div style={S.okBox}>{msg}</div>}
      {showForm && (
        <div style={S.card}>
          <h3 style={S.h3}>Add User</h3>
          <form onSubmit={addUser} style={S.form3}>
            <label style={S.label}>Username<input style={S.input} value={form.username} onChange={f("username")} required /></label>
            <label style={S.label}>Email<input style={S.input} type="email" value={form.email} onChange={f("email")} /></label>
            <label style={S.label}>Password (blank = Google only)<input style={S.input} type="password" value={form.password} onChange={f("password")} /></label>
            <label style={S.label}>Full Name<input style={S.input} value={form.name} onChange={f("name")} required /></label>
            <label style={S.label}>Badge #<input style={S.input} value={form.badge} onChange={f("badge")} required /></label>
            <label style={S.label}>Role
              <select style={S.select} value={form.role} onChange={f("role")}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="pending">Pending</option>
              </select>
            </label>
            <div style={{ gridColumn: "1/-1" }}><button style={S.btnPrimary} type="submit">Create User</button></div>
          </form>
        </div>
      )}
      {loading ? <div style={S.loading}>Loading…</div> : (
        <div style={S.card}>
          <table style={S.tbl}>
            <thead><tr>{["","Name","Username","Email","Badge","Role","Actions"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {users.map(u => {
                const initials = (u.name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
                return (
                  <tr key={u.id}>
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
                        <span style={{ display: "flex", gap: 4 }}>
                          <button style={S.btnGray} onClick={() => { setEditId(u.id); setEditData({}); }}>Edit</button>
                          {u.id !== currentUser.id && (
                            <button style={S.btnDanger} onClick={() => deleteUser(u.id)}>Delete</button>
                          )}
                        </span>
                      )}
                    </td>
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

// ─── Nav avatar (fetches latest avatar on mount) ─────────────────────────────
function NavAvatar({ user }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    api("/api/users/me").then(u => setSrc(u.avatar || null)).catch(() => {});
  }, []);
  const initials = (user.name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  if (src) return <img src={src} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", border: "2px solid #475569" }} />;
  return <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>{initials}</div>;
}

// ─── Profile Tab — available to all users ─────────────────────────────────────
function ProfileTab({ user }) {
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
      setMsg("Profile picture updated.");
    } catch (ex) { setErr(ex.message); }
    finally { setAvatarBusy(false); e.target.value = ""; }
  }

  async function removeAvatar() {
    setErr(""); setMsg("");
    try {
      await api("/api/users/me", { method: "PATCH", body: JSON.stringify({ avatar: null }) });
      setProfile(p => ({ ...p, avatar: null }));
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

// ─── Main App Shell ───────────────────────────────────────────────────────────
function MainApp({ user, onLogout }) {
  const isAdmin = user.role === "admin";
  const tabs = [
    { id: "inventory",    label: "Inventory",          show: isAdmin },  // admin only — users cannot view/manage inventory
    { id: "log-admin",    label: "Log Administration", show: true },
    { id: "pending",      label: "Pending",            show: isAdmin },
    { id: "admin-log",    label: "Admin Log",          show: true },
    { id: "purchases",    label: "Purchases",          show: isAdmin },
    { id: "transfers",    label: "Transfers",          show: true },
    { id: "waste",        label: "Waste",              show: true },
    { id: "audits",       label: "Audits",             show: true },
    { id: "monthly-logs", label: "Monthly Logs",       show: isAdmin },
    { id: "users",        label: "Users",              show: isAdmin },
    { id: "profile",      label: "My Profile",         show: true },
  ].filter(t => t.show);

  // Default tab: admin → inventory, user → log-admin
  const [tab, setTab] = useState(isAdmin ? "inventory" : "log-admin");

  const renderTab = () => {
    switch (tab) {
      case "inventory":    return <InventoryTab user={user} />;
      case "log-admin":    return <LogAdminTab  user={user} />;
      case "pending":      return <PendingTab />;
      case "admin-log":    return <AdminLogTab  user={user} />;
      case "purchases":    return <PurchasesTab />;
      case "transfers":    return <TransfersTab user={user} />;
      case "waste":        return <WasteTab     user={user} />;
      case "audits":       return <AuditsTab    user={user} />;
      case "monthly-logs": return <MonthlyLogsTab user={user} />;
      case "users":        return <UsersTab currentUser={user} />;
      case "profile":      return <ProfileTab user={user} />;
      default:             return null;
    }
  };

  return (
    <div style={S.app}>
      <nav style={S.nav}>
        <span style={S.navTitle}>🚑 NarcTrack EMS</span>
        {tabs.map(t => (
          <button key={t.id} style={S.navTab(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <div style={S.navUser}>
          <NavAvatar user={user} />
          <span>{user.name} · <span style={{ color: isAdmin ? "#818cf8" : "#38bdf8" }}>{user.role}</span></span>
          <button style={S.logoutBtn} onClick={onLogout}>Sign Out</button>
        </div>
      </nav>
      {renderTab()}
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

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth-callback" element={<AuthCallback />} />
        <Route path="/login" element={
          user ? <Navigate to="/" replace /> : <LoginPage onLogin={handleLogin} />
        } />
        <Route path="/" element={
          user ? <MainApp user={user} onLogout={handleLogout} /> : <Navigate to="/login" replace />
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
