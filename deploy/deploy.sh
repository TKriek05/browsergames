#!/usr/bin/env bash
# Deploy Timon's Arcade to the VPS (CloudPanel Node.js site) with one command:
#   ./deploy/deploy.sh            # tests, rsync, npm ci, pm2 reload, health check
#   ./deploy/deploy.sh --no-tests
set -euo pipefail

# --- Settings (adjust these) ---------------------------------------------------
# SSH must go to the REAL server IP (or a DNS-only record): Cloudflare's proxy
# only forwards HTTP(S), not SSH.
SSH_HOST="203.0.113.10"
SSH_USER="tkriek-games"                       # CloudPanel site user
SSH_PORT="22"
REMOTE_DIR="/home/tkriek-games/htdocs/games.tkriek.dev"
PUBLIC_URL="https://games.tkriek.dev"
PM2_APP="timons-arcade"
# ---------------------------------------------------------------------------------

cd "$(dirname "$0")/.."

if [[ "${1:-}" != "--no-tests" ]]; then
  echo "▶ Tests draaien…"
  npm test --silent
fi

if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "⚠ Let op: je hebt niet-gecommitte wijzigingen. Die worden ook gedeployed."
fi

# Unique build id for ?v= cache busting and the "new version" notice.
BUILD_ID="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date +%Y%m%d%H%M%S)"
echo "▶ Build: $BUILD_ID"

echo "▶ Bestanden synchroniseren…"
# Leading slash = only at the project root. Excluded paths are also
# protected from --delete on the server (.env, logs/, .build-id).
# deploy/ is excluded except the pm2 config, which the server needs.
rsync -avz --delete \
  -e "ssh -p $SSH_PORT" \
  --include '/deploy/' \
  --include '/deploy/ecosystem.config.cjs' \
  --exclude '/deploy/*' \
  --exclude '/.git' \
  --exclude '/.github' \
  --exclude '/node_modules' \
  --exclude '/tools' \
  --exclude '/test' \
  --exclude '/docs' \
  --exclude '/logs' \
  --exclude '/.env' \
  --exclude '/.build-id' \
  --exclude '/README.md' \
  --exclude '/CLAUDE.md' \
  ./ "$SSH_USER@$SSH_HOST:$REMOTE_DIR/"

echo "▶ Installeren en herladen op de server…"
ssh -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" bash -s -- "$REMOTE_DIR" "$BUILD_ID" "$PM2_APP" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"; BUILD_ID="$2"; PM2_APP="$3"
# CloudPanel installs Node per site user with nvm; non-interactive SSH does not load it.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$REMOTE_DIR"
mkdir -p logs
echo "$BUILD_ID" > .build-id
npm ci --omit=dev --no-audit --no-fund
if ! command -v pm2 >/dev/null; then npm install -g pm2; fi
# startOrReload: starts the first time, reloads afterwards (graceful SIGTERM).
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
pm2 status "$PM2_APP"
REMOTE

echo "▶ Health check…"
sleep 2
if curl -fsS "$PUBLIC_URL/healthz" | grep -q "$BUILD_ID"; then
  echo "✅ Live: $PUBLIC_URL (build $BUILD_ID)"
else
  echo "⚠ /healthz meldt (nog) niet build $BUILD_ID. Check: ssh $SSH_USER@$SSH_HOST 'pm2 logs $PM2_APP --lines 50'"
  exit 1
fi
