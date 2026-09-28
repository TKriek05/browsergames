#!/usr/bin/env bash
# =============================================================================
# Timon's Arcade – setup on a CloudPanel Node.js site
# =============================================================================
# Run as the SITE USER (never as root). Safe to run again: it then updates.
#
#   From your own computer (repo checked out):
#     ssh tkriek-games@<IP> 'bash -s -- --domain games.tkriek.dev' < deploy/cloudpanel-setup.sh
#
#   Or on the server, when the code is already there:
#     bash ~/htdocs/games.tkriek.dev/deploy/cloudpanel-setup.sh --domain games.tkriek.dev
#
# Options:
#   --domain NAME    site domain (default: the only folder in ~/htdocs)
#   --port N         App Port you chose in CloudPanel (default 3000)
#   --repo URL       git repository (default https://github.com/TKriek05/browsergames.git)
#                    private repo: use git@github.com:TKriek05/browsergames.git + a deploy key
#   --branch NAME    branch to run (default: the repository's default branch)
#   --no-git         don't clone/pull: the code arrives with deploy/deploy.sh (rsync)
#   --node N         Node.js major version (default 22)
#
# What it does:
#   1. checks Node.js (installs it with nvm when needed)
#   2. gets the code with git (clone or update)
#   3. writes .env (only the first time) and .build-id
#   4. npm ci --omit=dev
#   5. starts or reloads the app with pm2 and saves the process list
#   6. makes pm2 start again after a server reboot (crontab @reboot)
#   7. checks http://127.0.0.1:<port>/healthz
#   8. writes a ready-to-paste nginx snippet for the CloudPanel Vhost editor
# =============================================================================
set -euo pipefail

DOMAIN=""
PORT="3000"
REPO="https://github.com/TKriek05/browsergames.git"
BRANCH=""
USE_GIT=1
NODE_MAJOR=22
NVM_VERSION="v0.40.3"
PM2_APP="timons-arcade"

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# nvm breaks under `set -eu`: relax both while it runs.
load_nvm() {
  export NVM_DIR="$HOME/.nvm"
  set +eu
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  set -eu
}

node_major() {
  local v
  v="$(node -v 2>/dev/null || true)"
  v="${v#v}"
  v="${v%%.*}"
  if [[ "$v" =~ ^[0-9]+$ ]]; then echo "$v"; else echo 0; fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) DOMAIN="${2:-}"; shift 2 ;;
      --port) PORT="${2:-}"; shift 2 ;;
      --repo) REPO="${2:-}"; shift 2 ;;
      --branch) BRANCH="${2:-}"; shift 2 ;;
      --no-git) USE_GIT=0; shift ;;
      --node) NODE_MAJOR="${2:-}"; shift 2 ;;
      -h|--help) sed -n '2,31p' "$0" 2>/dev/null || true; exit 0 ;;
      *) die "Onbekende optie: $1 (zie --help)" ;;
    esac
  done
}

main() {
  parse_args "$@"
  # When run as `ssh … 'bash -s' < script`, stdin IS this script: make sure no
  # child process (npm, git, curl | bash) reads from it.
  exec </dev/null

  # --- 0. Checks ------------------------------------------------------------------
  if [ "$(id -u)" -eq 0 ]; then die "Draai dit als de site-user (bijv. tkriek-games), niet als root."; fi
  [[ "$PORT" =~ ^[0-9]{2,5}$ ]] || die "Ongeldige poort: $PORT"
  [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || die "Ongeldige Node-versie: $NODE_MAJOR"

  if [ -z "$DOMAIN" ]; then
    local sites
    mapfile -t sites < <(ls -1 "$HOME/htdocs" 2>/dev/null || true)
    [ "${#sites[@]}" -eq 1 ] || die "Geef het domein op met --domain (gevonden in ~/htdocs: ${sites[*]:-niets})"
    DOMAIN="${sites[0]}"
  fi
  local site_dir="$HOME/htdocs/$DOMAIN"
  [ -d "$site_dir" ] || die "Map $site_dir bestaat niet. Maak eerst de Node.js-site '$DOMAIN' aan in CloudPanel."
  say "Timon's Arcade installeren in $site_dir (poort $PORT)"

  # --- 1. Node.js via nvm ------------------------------------------------------------
  say "Node.js controleren"
  load_nvm
  if [ "$(node_major)" -lt "$NODE_MAJOR" ]; then
    if ! command -v nvm >/dev/null 2>&1; then
      warn "nvm niet gevonden: installeren ($NVM_VERSION)"
      curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash
      load_nvm
    fi
    set +eu
    nvm install "$NODE_MAJOR" && nvm alias default "$NODE_MAJOR"
    local rc=$?
    set -eu
    [ "$rc" -eq 0 ] || die "Node.js $NODE_MAJOR installeren met nvm is mislukt."
  fi
  command -v npm >/dev/null 2>&1 || die "npm niet gevonden."
  ok "Node $(node -v), npm $(npm -v)"

  # --- 2. Code ---------------------------------------------------------------------------
  cd "$site_dir"
  if [ "$USE_GIT" -eq 1 ]; then
    say "Code ophalen uit $REPO"
    export GIT_TERMINAL_PROMPT=0 # never hang on a password prompt
    if [[ "$REPO" == git@* ]]; then
      mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
      grep -qs '^github.com ' "$HOME/.ssh/known_hosts" || ssh-keyscan -t ed25519 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
      if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
        ssh-keygen -q -t ed25519 -N '' -C "deploy@$DOMAIN" -f "$HOME/.ssh/id_ed25519"
        printf '\nVoeg deze publieke sleutel toe als *Deploy key* (alleen lezen):\nGitHub → repo → Settings → Deploy keys → Add deploy key\n\n'
        cat "$HOME/.ssh/id_ed25519.pub"
        die "Sleutel aangemaakt. Voeg hem toe op GitHub en draai dit script daarna opnieuw."
      fi
    fi
    if [ -z "$BRANCH" ]; then
      BRANCH="$(git ls-remote --symref "$REPO" HEAD 2>/dev/null | awk '/^ref:/ { sub("refs/heads/", "", $2); print $2 }' || true)"
      [ -n "$BRANCH" ] || die "Kan $REPO niet lezen. Privé-repo? Gebruik --repo git@github.com:… (deploy key) of maak de repo publiek."
    fi
    if [ ! -d .git ]; then
      # Works in a non-empty folder too (unlike git clone).
      git init -q
      git remote add origin "$REPO"
    else
      git remote set-url origin "$REPO"
    fi
    git fetch -q --depth 1 origin "$BRANCH" || die "Ophalen van branch '$BRANCH' uit $REPO mislukt."
    # .env, .build-id, logs/ and node_modules/ are ignored by git and stay untouched.
    git checkout -q -f -B "$BRANCH" FETCH_HEAD
    ok "Branch $BRANCH op commit $(git rev-parse --short HEAD)"
  else
    [ -f package.json ] || die "Geen code gevonden in $site_dir. Draai eerst ./deploy/deploy.sh vanaf je computer, of laat --no-git weg."
    ok "Code staat er al (--no-git)"
  fi
  [ -f deploy/ecosystem.config.cjs ] || die "deploy/ecosystem.config.cjs ontbreekt."

  # --- 3. Configuration ----------------------------------------------------------------------
  say "Instellingen (.env)"
  if [ ! -f .env ]; then
    cat > .env <<EOF
# Timon's Arcade – server settings (made by cloudpanel-setup.sh). Not in git.
PORT=$PORT
HOST=127.0.0.1
ALLOWED_ORIGINS=https://$DOMAIN
MAX_ROOMS=500
LOG_LEVEL=info
TRUST_PROXY=loopback
# A school class often shares one IP address: raise these when needed.
MAX_CONN_PER_IP=24
MAX_ROOMS_PER_IP=8
EOF
    chmod 600 .env
    ok ".env aangemaakt"
  else
    local current_port
    current_port="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"
    if [ "$current_port" != "$PORT" ]; then warn ".env gebruikt PORT=$current_port (niet $PORT). Pas .env aan als dat niet klopt."; fi
    ok ".env bestaat al (niet overschreven)"
  fi
  if [ "$USE_GIT" -eq 1 ]; then
    echo "$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)" > .build-id
  fi
  [ -f .build-id ] || echo "setup-$(date +%Y%m%d%H%M%S)" > .build-id
  ok "Build $(cat .build-id)"

  # --- 4. Dependencies ------------------------------------------------------------------------
  say "Dependencies installeren (npm ci)"
  npm ci --omit=dev --no-audit --no-fund
  ok "Klaar"

  # --- 5. pm2 ------------------------------------------------------------------------------------
  say "App starten met pm2"
  if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2 --no-audit --no-fund || die "pm2 installeren mislukt (npm install -g pm2)."
  fi
  mkdir -p logs
  pm2 startOrReload deploy/ecosystem.config.cjs --update-env
  pm2 save
  ok "pm2 draait '$PM2_APP'"

  # --- 6. Start after a reboot ----------------------------------------------------------------
  say "Automatisch starten na een reboot"
  local boot="$HOME/.arcade-boot.sh"
  cat > "$boot" <<'EOF'
#!/usr/bin/env bash
# Started by cron (@reboot): bring back the saved pm2 processes.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
pm2 resurrect
EOF
  chmod 700 "$boot"
  { crontab -l 2>/dev/null | grep -v 'arcade-boot' || true; echo "@reboot $boot >> $HOME/.arcade-boot.log 2>&1"; } | crontab -
  ok "crontab: @reboot $boot"

  # --- 7. Health check --------------------------------------------------------------------------
  say "Health check"
  local healthy=0
  for _ in $(seq 1 15); do
    if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 1
  done
  if [ "$healthy" -eq 1 ]; then
    ok "$(curl -fsS "http://127.0.0.1:$PORT/healthz")"
  else
    warn "Geen antwoord op poort $PORT. Kijk in: pm2 logs $PM2_APP --lines 50"
  fi

  # --- 8. Vhost snippet --------------------------------------------------------------------------
  local snippet="$HOME/arcade-vhost-snippet.conf"
  if [ -f deploy/nginx-snippet.conf ]; then
    sed "s/games\.tkriek\.dev/$DOMAIN/g" deploy/nginx-snippet.conf > "$snippet"
    ok "Vhost-snippet klaargezet: $snippet"
  fi

  cat <<EOF

────────────────────────────────────────────────────────────────────
 Klaar! De app draait op http://127.0.0.1:$PORT

 Nog doen in CloudPanel (eenmalig, zie docs/CLOUDPANEL.md):
  1. Sites → $DOMAIN → Vhost: vervang het "location /"-blok door de
     inhoud van $snippet  (cat $snippet)
  2. SSL/TLS: Let's Encrypt-certificaat (Cloudflare tijdelijk op "Full")
  3. Security: "Allow traffic from Cloudflare only" aanzetten

 Handig:
  pm2 status · pm2 logs $PM2_APP · pm2 reload $PM2_APP
  Updaten: dit script opnieuw draaien (of ./deploy/deploy.sh vanaf je pc)
────────────────────────────────────────────────────────────────────
EOF
}

# Everything runs from main(), so bash has read the whole script before any
# command executes (important when the script arrives via stdin).
main "$@"
