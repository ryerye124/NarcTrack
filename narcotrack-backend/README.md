# NarcTrack EMS — Deployment Guide
### NYS 10 NYCRR §80.136 Controlled Substance Management
---

## What You're Deploying

| Piece | What it is | Where it lives | Cost |
|---|---|---|---|
| Frontend | The React app your team uses | Vercel | Free |
| Backend API | Node.js server (this folder) | Railway | Free |
| Database | PostgreSQL | Supabase | Free |
| Auth | Google Sign-In | Google Cloud | Free |
| Code storage | Version control | GitHub | Free |

**Total monthly cost to start: $0**

---

## Before You Start — Install These Once

1. **Node.js** — download from nodejs.org (LTS version)
2. **Git** — download from git-scm.com
3. **A code editor** — VS Code is free at code.visualstudio.com

---

## STEP 1 — Set Up GitHub

This stores your code and connects to your deployment services.

1. Go to **github.com** → Sign up or log in
2. Click **New repository** (the green button)
3. Name it: `narcotrack`
4. Set it to **Private**
5. Click **Create repository**

Now on your computer, open Terminal (Mac) or Command Prompt (Windows):

```bash
# Navigate to where you saved the narcotrack-backend folder
cd path/to/narcotrack-backend

# Initialize git and push
git init
git add .
git commit -m "initial NarcTrack backend"
git branch -M main
git remote add origin https://github.com/YOURGITHUBNAME/narcotrack.git
git push -u origin main
```

Do the same in a separate folder for your frontend (the .jsx file):

```bash
# Create a new React app and replace the App component
npx create-react-app narcotrack-frontend
cd narcotrack-frontend
# Replace src/App.js content with the narcotics-tracker.jsx code
git init
git add .
git commit -m "initial NarcTrack frontend"
git remote add origin https://github.com/YOURGITHUBNAME/narcotrack-frontend.git
git push -u origin main
```

---

## STEP 2 — Set Up Supabase (Database)

1. Go to **supabase.com** → Sign up → **New project**
2. Name it `narcotrack`, choose a strong password, pick the closest region
3. Wait ~2 minutes for it to provision
4. Click **SQL Editor** in the left sidebar
5. Click **New query**
6. Copy the entire contents of **database.sql** and paste it in
7. Click **Run** — you should see "Success"

Get your connection string:
- Left sidebar → **Settings** → **Database**
- Copy the **Connection string** under "URI"
- It looks like: `postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres`
- **Save this** — you'll need it in Step 4

---

## STEP 3 — Set Up Google OAuth

1. Go to **console.cloud.google.com**
2. Click the project dropdown at the top → **New Project**
3. Name it `NarcTrack` → **Create**
4. Left menu → **APIs & Services** → **OAuth consent screen**
5. Choose **Internal** (IMPORTANT — this means only people in your Google Workspace org can sign in)
   - If you don't have Google Workspace, choose External, then add each user's email under "Test users"
6. Fill in:
   - App name: `NarcTrack EMS`
   - User support email: your email
   - Developer contact: your email
7. Click **Save and Continue** through the remaining screens
8. Left menu → **Credentials** → **+ Create Credentials** → **OAuth 2.0 Client ID**
9. Application type: **Web application**
10. Name: `NarcTrack`
11. Under **Authorized redirect URIs**, add:
    ```
    https://narcotrack-api.railway.app/api/auth/google/callback
    ```
    (You'll add the real Railway URL after Step 4 — put this placeholder for now)
12. Click **Create**
13. **Save your Client ID and Client Secret** — you'll need these in Step 4

---

## STEP 4 — Deploy the Backend on Railway

1. Go to **railway.app** → Sign up with your GitHub account
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `narcotrack` backend repo
4. Railway will detect it's a Node.js app and start deploying
5. Click on your deployment → **Variables** tab
6. Add each of these variables (click **+ New Variable** for each):

```
DATABASE_URL       = [paste your Supabase connection string from Step 2]
JWT_SECRET         = [generate: open terminal, run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"]
SESSION_SECRET     = [generate another one the same way]
GOOGLE_CLIENT_ID   = [from Step 3]
GOOGLE_CLIENT_SECRET = [from Step 3]
FRONTEND_URL       = https://narcotrack.vercel.app  (update after Step 5)
NODE_ENV           = production
PORT               = 3001
```

7. After adding variables, Railway will redeploy automatically
8. Click **Settings** → find your **Public Domain** — it looks like `narcotrack-api.railway.app`
9. **Save this URL**
10. Go back to Google Cloud Console → Credentials → edit your OAuth client
11. Update the redirect URI to: `https://[your-actual-railway-url]/api/auth/google/callback`
12. Also update `API_URL` in Railway variables to your actual Railway URL

---

## STEP 5 — Deploy the Frontend on Vercel

1. Go to **vercel.com** → Sign up with your GitHub account
2. Click **Add New Project** → Import your `narcotrack-frontend` repo
3. Vercel detects it's a Create React App project
4. Under **Environment Variables**, add:
   ```
   REACT_APP_API_URL = https://[your-railway-url]
   ```
5. Click **Deploy**
6. After deploy, Vercel gives you a URL like `narcotrack.vercel.app`
7. Go back to Railway → update `FRONTEND_URL` to your actual Vercel URL
8. Go back to Railway → redeploy (Variables tab → trigger redeploy)

---

## STEP 6 — Connect the Frontend to Your API

In the frontend code, replace the `localStorage` calls with API calls. In every place the app calls `dispatch({type: ...})`, replace with a `fetch()` to your Railway URL.

The key places to update:

```javascript
// At the top of App.jsx, add:
const API = process.env.REACT_APP_API_URL;

// Store the JWT token (from Google login callback):
// In your /auth-callback route handler:
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
if (token) {
  sessionStorage.setItem('narcotrack_token', token);
  // redirect to dashboard
}

// Helper for authenticated requests:
async function api(path, options = {}) {
  const token = sessionStorage.getItem('narcotrack_token');
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Example — submit administration:
// Old: dispatch({ type: "SUBMIT_ADMINISTRATION", payload: form })
// New:
await api('/api/pending', { method: 'POST', body: JSON.stringify(form) });

// Example — verify pending:
// Old: dispatch({ type: "VERIFY_ADMINISTRATION", id: rec.id, ... })
// New:
await api(`/api/pending/${rec.id}/verify`, { method: 'POST', body: JSON.stringify({ note }) });
```

---

## STEP 7 — First Login

1. Open your Vercel URL
2. Log in with username `admin` and password `admin123`
3. **IMMEDIATELY** go to Users → change the admin password or switch to Google Sign-In
4. Add your team members in the Users tab
5. Have each person sign in with Google — they'll get a "pending" status
6. You assign their role (admin or user) and badge number

---

## STEP 8 — Exporting DOH-3850 and DOH-3851

Once live, the export buttons in the Monthly Logs tab will download pre-formatted CSV files:

- **DOH-3850** — Administration records for a given month, all §80.136(h) fields
- **DOH-3851** — Purchase and inventory records for a given month

To open in Excel:
1. Download the CSV
2. Open Excel → **File** → **Open** → select the CSV
3. Excel's import wizard opens — select **Comma** as the delimiter
4. The columns will map directly to the DOH form fields

---

## Ongoing Maintenance

**To update the app after making code changes:**
```bash
git add .
git commit -m "describe what changed"
git push
```
Vercel and Railway auto-deploy within 60 seconds. No manual steps.

**To back up your database:**
- Supabase dashboard → **Database** → **Backups**
- Free tier keeps 7 days of automatic backups
- You can also export any table to CSV directly from Supabase

**When to upgrade from free tier:**
- Supabase free: 500MB storage, 2 projects. Upgrade ($25/mo) when you hit limits.
- Railway free: $5 credit/month. Upgrade Hobby ($5/mo) for guaranteed uptime.
- Vercel free: 100GB bandwidth/month. More than enough for this use case.

---

## Security Notes

- Never commit your `.env` file to GitHub. The `.gitignore` file prevents this.
- JWT tokens expire after 12 hours — users re-authenticate daily.
- All passwords are bcrypt-hashed with 12 rounds before storage.
- The database is only accessible through the API — not exposed to the public.
- Use Internal OAuth (Google Workspace) so only your org can log in.
- For HIPAA/PHI compliance considerations, consult your agency's compliance officer.

---

## Folder Structure

```
narcotrack/
├── narcotrack-backend/
│   ├── index.js          ← entire backend API
│   ├── database.sql      ← run this in Supabase once
│   ├── package.json
│   ├── .env.example      ← copy to .env, fill in secrets
│   └── .gitignore
└── narcotrack-frontend/
    ├── src/
    │   └── App.jsx       ← the React app
    └── package.json
```

---

## Getting Help

- Railway docs: docs.railway.app
- Supabase docs: supabase.com/docs
- Vercel docs: vercel.com/docs
- Google OAuth docs: developers.google.com/identity/protocols/oauth2

If you get stuck on any step, the error message from the terminal or browser console will tell you exactly what went wrong. The most common issues are:
1. Wrong DATABASE_URL — double check the Supabase connection string
2. CORS error — make sure FRONTEND_URL in Railway matches your exact Vercel URL
3. Google OAuth error — make sure the redirect URI in Google Cloud matches Railway exactly
