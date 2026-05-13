#!/usr/bin/env bash
# ─── NarcTrack Deploy — redeploys frontend (Vercel) + backend (Railway) ───────
# First run: will prompt you to link each project once.
# Every run after that: deploys both in parallel, streams both logs.

set -euo pipefail

# nvm puts CLIs in a versioned path that non-interactive shells don't see — add it explicitly
export PATH="/Users/ryan/.nvm/versions/node/v20.20.2/bin:$PATH"

REPO="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$REPO/narcotrack-frontend"
BACKEND="$REPO/narcotrack-backend"

# Colors
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  NarcTrack Deploy${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── One-time link check ────────────────────────────────────────────────────────

if [ ! -f "$FRONTEND/.vercel/project.json" ]; then
  echo -e "${YELLOW}[Vercel] Not linked — running 'vercel link' now (one-time setup)...${NC}"
  echo ""
  cd "$FRONTEND" && vercel link
  echo ""
fi

if [ ! -f "$BACKEND/.railway" ] && ! railway status --path "$BACKEND" &>/dev/null; then
  echo -e "${YELLOW}[Railway] Not linked — running 'railway link' now (one-time setup)...${NC}"
  echo ""
  cd "$BACKEND" && railway link
  echo ""
fi

# ── Build frontend ────────────────────────────────────────────────────────────

echo -e "${GREEN}Building frontend...${NC}"
cd "$FRONTEND"
npm install --silent
npm run build 2>&1 | sed 's/^/[Build]   /'
echo ""

# ── Deploy in parallel ─────────────────────────────────────────────────────────

echo -e "${GREEN}Deploying frontend + backend in parallel...${NC}"
echo ""

FRONTEND_LOG=$(mktemp)
BACKEND_LOG=$(mktemp)

# Frontend — deploy pre-built dist/ to Vercel
(
  cd "$FRONTEND"
  vercel deploy --prod --yes --prebuilt 2>&1 | tee "$FRONTEND_LOG" | sed 's/^/[Vercel]  /'
) &
FRONTEND_PID=$!

# Backend — Railway deploy
(
  cd "$BACKEND"
  railway up --detach 2>&1 | tee "$BACKEND_LOG" | sed 's/^/[Railway] /'
) &
BACKEND_PID=$!

# Wait for both and collect exit codes
FRONTEND_STATUS=0
BACKEND_STATUS=0

wait $FRONTEND_PID || FRONTEND_STATUS=$?
wait $BACKEND_PID  || BACKEND_STATUS=$?

# ── Results ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ $FRONTEND_STATUS -eq 0 ]; then
  VERCEL_URL=$(grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' "$FRONTEND_LOG" | tail -1)
  echo -e "${GREEN}✓ Frontend deployed${NC}  ${VERCEL_URL:-}"
else
  echo -e "${RED}✗ Frontend deploy failed — check output above${NC}"
fi

if [ $BACKEND_STATUS -eq 0 ]; then
  echo -e "${GREEN}✓ Backend deployed${NC}"
else
  echo -e "${RED}✗ Backend deploy failed — check output above${NC}"
fi

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

rm -f "$FRONTEND_LOG" "$BACKEND_LOG"

# Exit non-zero if either failed
[ $FRONTEND_STATUS -eq 0 ] && [ $BACKEND_STATUS -eq 0 ]
