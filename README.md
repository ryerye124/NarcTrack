# NarcTrack EMS
### NYS 10 NYCRR §80.136 Controlled Substance Management

A full-stack web app for EMS agencies to track controlled substance administration, inventory, purchases, transfers, waste, audits, and monthly compliance reports — with one-click DOH-3850 and DOH-3851 CSV exports.

---

## Stack

| Piece | Technology | Host |
|---|---|---|
| Frontend | React 18 + Vite + React Router | Vercel (free) |
| Backend API | Node.js + Express + JWT | Railway (free) |
| Database | PostgreSQL | Supabase (free) |
| Auth | Google OAuth 2.0 + local login | Google Cloud (free) |

---

## Repo Structure

```
NarcTrack/
├── narcotrack-backend/     Node/Express API
│   ├── index.js            All API routes
│   ├── database.sql        Run once in Supabase to create tables + seed data
│   ├── package.json
│   └── .env.example        Copy to .env and fill in your secrets
└── narcotrack-frontend/    React app
    ├── src/App.jsx         Entire frontend (all tabs, OAuth, DOH exports)
    ├── index.html
    ├── vite.config.js
    └── .env.example        Copy to .env.local — set VITE_API_URL
```

---

## Features

- **Google Sign-In** — team members sign in with Google; admin assigns roles and badge numbers
- **Local login** — fallback username/password for admin bootstrap
- **Inventory** — live stock levels per location, low-stock alerts
- **Log Administration** — paramedic submits drug administration; deducts inventory immediately
- **Pending Verifications** — admin reviews, verifies, or rejects each submission
- **Administration Log** — filterable by month, stock, status; full §80.136(h) field set
- **Purchases** — log incoming controlled substance deliveries; updates inventory automatically
- **Transfers** — move drugs between stock locations with witness signature
- **Waste / Destruction** — log witnessed disposal with method tracking
- **Audits / Shift Count** — compare expected vs. counted quantity per drug, flag discrepancies
- **Monthly Logs** — save monthly review with MD sign-off; auto-counts activity for the period
- **DOH-3850 Export** — CSV of all verified administrations for the month, mapped to form columns
- **DOH-3851 Export** — CSV of purchases, transfers, and inventory snapshot for the month
- **Annual Report** — full-year drug summary + administration records

---

## Setup

### 1 — Database (Supabase)

1. Go to [supabase.com](https://supabase.com) → New project
2. SQL Editor → New query → paste contents of `narcotrack-backend/database.sql` → Run
3. Settings → Database → copy the **Connection string (URI)**

### 2 — Google OAuth

1. [console.cloud.google.com](https://console.cloud.google.com) → New project → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID → Web application
3. Authorized redirect URI: `https://YOUR-RAILWAY-URL/api/auth/google/callback`
4. Save your **Client ID** and **Client Secret**

### 3 — Backend (Railway)

1. [railway.app](https://railway.app) → New project → Deploy from GitHub → select this repo → set root directory to `narcotrack-backend`
2. Add environment variables:

```
DATABASE_URL        = (Supabase connection string)
JWT_SECRET          = (run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
SESSION_SECRET      = (generate same way)
GOOGLE_CLIENT_ID    = (from Google Cloud)
GOOGLE_CLIENT_SECRET= (from Google Cloud)
API_URL             = https://your-app.railway.app
FRONTEND_URL        = https://your-app.vercel.app
NODE_ENV            = production
PORT                = 3001
```

### 4 — Frontend (Vercel)

1. [vercel.com](https://vercel.com) → New project → Import this repo → set root directory to `narcotrack-frontend`
2. Add environment variable:

```
VITE_API_URL = https://your-app.railway.app
```

3. Deploy → copy your Vercel URL → go back to Railway and update `FRONTEND_URL`

### 5 — First Login

Default admin credentials (change immediately):
- Username: `admin`
- Password: `admin123`

---

## Local Development

```bash
# Backend
cd narcotrack-backend
cp .env.example .env        # fill in your values
npm install
npm run dev                 # runs on http://localhost:3001

# Frontend (separate terminal)
cd narcotrack-frontend
cp .env.example .env.local  # set VITE_API_URL=http://localhost:3001
npm install
npm run dev                 # runs on http://localhost:5173
```

---

## Pushing Updates

```bash
git add .
git commit -m "describe what changed"
git push
```

Vercel and Railway auto-deploy within ~60 seconds of every push.

---

## Security Notes

- Never commit `.env` files — they are in `.gitignore`
- JWT tokens expire after 12 hours
- Passwords are bcrypt-hashed (12 rounds)
- Use Google OAuth with Internal mode (Google Workspace) to restrict login to your org
- The database is only reachable through the API
