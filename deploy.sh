#!/usr/bin/env bash
# ─── NarcTrack Deploy — redeploys frontend (Vercel) + backend (Railway) ───────

set -euo pipefail

export PATH="/Users/ryan/.nvm/versions/node/v20.20.2/bin:$PATH"

REPO="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$REPO/narcotrack-frontend"
BACKEND="$REPO/narcotrack-backend"

VERCEL_TOKEN="vca_4jiu9Key38xkZj1Z7oMEScsMCXujvApd2al37Tm0AOXwTmBzGb0i9AFc"
VERCEL_PROJECT="prj_Z4cS4mNXE7o4zb72yBnOK23jMP6R"
VERCEL_TEAM="team_iW4vADclKtQLggeMF7NSL202"
GITHUB_REPO_ID="1236747563"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  NarcTrack Deploy${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── Ensure git is clean and pushed ────────────────────────────────────────────

cd "$REPO"

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${YELLOW}Uncommitted changes detected — committing and pushing...${NC}"
  git add -A
  git commit -m "deploy: auto-commit before deploy $(date '+%Y-%m-%d %H:%M')"
fi

# Push to origin
echo -e "${GREEN}Pushing to GitHub...${NC}"
git push origin main 2>&1 | sed 's/^/[git]     /'
echo ""

# Get the latest commit SHA
SHA=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "${GREEN}Deploying commit ${SHA:0:7} (${BRANCH})${NC}"
echo ""

# ── Deploy Vercel via API (git-based — reliable, no CLI path issues) ──────────

echo -e "${GREEN}Triggering Vercel deployment...${NC}"

DEPLOY_RESPONSE=$(curl -s -X POST \
  "https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM}&forceNew=1" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"narcotrack-frontend\",
    \"project\": \"${VERCEL_PROJECT}\",
    \"target\": \"production\",
    \"gitSource\": {
      \"type\": \"github\",
      \"repoId\": \"${GITHUB_REPO_ID}\",
      \"ref\": \"${BRANCH}\",
      \"sha\": \"${SHA}\"
    }
  }")

DEPLOY_ID=$(echo "$DEPLOY_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
DEPLOY_URL=$(echo "$DEPLOY_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('url',''))" 2>/dev/null)

if [ -z "$DEPLOY_ID" ]; then
  echo -e "${RED}✗ Failed to create Vercel deployment${NC}"
  echo "$DEPLOY_RESPONSE"
  FRONTEND_STATUS=1
else
  echo "  Deployment ID: $DEPLOY_ID"
  echo "  Preview URL:   https://$DEPLOY_URL"
  FRONTEND_STATUS=0
fi

# ── Deploy Railway (parallel while Vercel builds) ──────────────────────────────

BACKEND_LOG=$(mktemp)
BACKEND_STATUS=0

(
  cd "$BACKEND"
  railway up --detach 2>&1 | tee "$BACKEND_LOG" | sed 's/^/[Railway] /'
) &
BACKEND_PID=$!

# ── Poll Vercel until ready ───────────────────────────────────────────────────

if [ $FRONTEND_STATUS -eq 0 ]; then
  echo ""
  echo -e "${GREEN}Waiting for Vercel build...${NC}"
  VERCEL_FINAL_STATE=""
  for i in $(seq 1 60); do
    VERCEL_FINAL_STATE=$(curl -s \
      "https://api.vercel.com/v13/deployments/${DEPLOY_ID}?teamId=${VERCEL_TEAM}" \
      -H "Authorization: Bearer ${VERCEL_TOKEN}" | \
      python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('readyState',''))" 2>/dev/null)
    if [[ "$VERCEL_FINAL_STATE" == "READY" || "$VERCEL_FINAL_STATE" == "ERROR" || "$VERCEL_FINAL_STATE" == "CANCELED" ]]; then
      break
    fi
    printf "."
    sleep 5
  done
  echo ""

  if [ "$VERCEL_FINAL_STATE" != "READY" ]; then
    FRONTEND_STATUS=1
  fi
fi

# ── Wait for Railway ──────────────────────────────────────────────────────────

wait $BACKEND_PID || BACKEND_STATUS=$?

# ── Results ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ $FRONTEND_STATUS -eq 0 ]; then
  PROD_URL=$(curl -s \
    "https://api.vercel.com/v9/projects/${VERCEL_PROJECT}?teamId=${VERCEL_TEAM}" \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" | \
    python3 -c "import json,sys; d=json.load(sys.stdin); aliases=d.get('alias',[]); [print(a.get('domain','')) for a in aliases if 'git' not in a.get('domain','') and 'preview' not in a.get('domain','')]" 2>/dev/null | head -1)
  echo -e "${GREEN}✓ Frontend deployed${NC}  https://${PROD_URL:-narcotrack-frontend-ryan-s-projects23.vercel.app}"
else
  echo -e "${RED}✗ Frontend deploy failed (state: ${VERCEL_FINAL_STATE:-unknown})${NC}"
fi

if [ $BACKEND_STATUS -eq 0 ]; then
  echo -e "${GREEN}✓ Backend deployed${NC}"
else
  echo -e "${RED}✗ Backend deploy failed — check output above${NC}"
fi

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

rm -f "$BACKEND_LOG"

[ $FRONTEND_STATUS -eq 0 ] && [ $BACKEND_STATUS -eq 0 ]
