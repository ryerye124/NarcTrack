# NarcTrack EMS — Changelog
NYS 10 NYCRR §80.136 Controlled Substance Management

---

## [v1.2.0] — 2026-05-12 — Bug Fix Release

### Bugs Reported & Fixed

| ID | Severity | Component | Description | Status |
|---|---|---|---|---|
| BUG-001 | 🔴 Critical | TransfersTab | `blank()` hardcoded `fromStock: "Main Stock"` — non-admin users don't have Main Stock in their available stocks. React rendered "929" visually but state held "Main Stock" → backend rejected with "Users cannot access Main Stock" | ✅ Fixed |
| BUG-002 | 🔴 Critical | TransfersTab | `fromStock onChange` used simple field updater — did not clear `drug`, `conc`, or `unit`. Changing From Stock after selecting a drug left stale values → backend could not find drug in new stock → "Insufficient inventory in source stock" error | ✅ Fixed |
| BUG-003 | 🟠 High | TransfersTab | `toStock` state was never corrected when `fromStock` changed to equal it. Filter removed the matching option from the dropdown visually but state held the same value → transfer submitted with `fromStock === toStock` (same-stock transfer, net-zero change, silent data error) | ✅ Fixed |
| BUG-004 | 🟠 High | AuditsTab | Default stock for non-admin users was hardcoded `"Sub-Stock 1"` — stock was renamed to "929" in a prior release but this default was not updated → audit form showed no drugs for non-admin users | ✅ Fixed |
| BUG-005 | 🟡 Medium | WasteTab | Stock `onChange` used simple field updater — did not clear `drug`, `conc`, or `unit`. Changing stock after selecting a drug left stale values → backend could not find drug in new stock → waste record failed | ✅ Fixed |
| BUG-006 | 🟡 Medium | LogAdminTab | `availStocks` was defined **after** `blank()` in the function body but referenced inside `blank()`. Relied on JavaScript closure timing that is valid but fragile. Moved `availStocks` above `blank()` to eliminate the dependency on implicit ordering | ✅ Fixed |
| BUG-007 | ⚪ Low | MonthlyLogs | `doExport(type, color)` declared `color` as a parameter but never used it | ✅ Fixed |

### Changes
- `TransfersTab`: Added `onFromStockChange()` handler — resets `drug`/`conc`/`unit` to empty, auto-corrects `toStock` if it matches new `fromStock`
- `TransfersTab`: Moved `availStocks` above `blank()` so defaults are role-aware (`availStocks[0]` / `availStocks[1]`)
- `AuditsTab`: Default stock for non-admin changed from `"Sub-Stock 1"` → first non-admin available stock (`"929"`)
- `WasteTab`: Stock dropdown now uses inline handler that clears drug/conc/unit on change
- `MonthlyLogs`: Removed unused `color` parameter from `doExport()`

---

## [v1.1.0] — 2026-05-12 — Cascading Dropdowns & Auto mL Calculation

### Changes
- **LogAdminTab**: Drug dropdown auto-fills Concentration and Unit from inventory (readonly fields)
- **LogAdminTab**: Changing Stock clears Drug/Conc/Unit and resets dose inputs
- **LogAdminTab**: New Dose Amount input (number) with unit selector (mg / mcg / g)
- **LogAdminTab**: Volume Withdrawn (mL) auto-calculated: `dose ÷ concentration` via `calcML()` helper. Turns green when valid. Submit button disabled until mL resolves.
- **LogAdminTab**: Added `calcML()` helper — parses concentration strings like "10mg/mL", "500mcg/mL", "1g/mL" with cross-unit conversion (mg ↔ mcg ↔ g)
- **TransfersTab**: Drug selection now also auto-fills Unit (readonly)
- **WasteTab**: Drug selection now also auto-fills Unit (readonly)
- **TransfersTab / WasteTab**: Fixed stale `"Sub-Stock 1"` default → `"929"`

---

## [v1.0.0] — 2026-05-11 — Initial Deployment

### Features
- Google OAuth 2.0 + local username/password login
- JWT auth (12h expiry), sessionStorage token storage
- Full §80.136 field set: Inventory, Log Administration, Pending Verifications, Administration Log, Purchases, Transfers, Waste/Destruction, Audits/Shift Count, Monthly Logs, User Management
- DOH-3850 CSV export (administration records)
- DOH-3851 CSV export (purchases + transfers + inventory snapshot)
- Annual report CSV
- Stock locations: Main Stock, 929, 9299
- Role-based access: admin sees all; user sees own records + sub-stocks only

### Infrastructure
- Frontend: React 18 + Vite → Vercel
- Backend: Node.js + Express + JWT → Railway
- Database: PostgreSQL → Railway (migrated from Supabase due to IPv6 connectivity)
- Source control: GitHub (ryerye124/NarcTrack)

### Known Limitations
- Inventory tab (admin): no edit/delete for existing inventory entries
- No inline admin approval from LogAdminTab (all submissions go through Pending tab)
