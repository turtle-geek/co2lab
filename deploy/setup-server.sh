#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 Vultr server. Run as root:
#   bash setup-server.sh <hub-domain>
# Installs Node 24, Caddy (automatic HTTPS), Playwright Chromium, clones the repo to /opt/co2lab,
# and installs the systemd services for the hub and the cloud worker. Safe to re-run.
set -euo pipefail

DOMAIN="${1:?usage: setup-server.sh <hub-domain>}"
REPO="https://github.com/turtle-geek/co2lab.git"
APP_DIR=/opt/co2lab
APP_USER=co2lab

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ufw ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# Node.js 24
if ! node -v 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

# Caddy (official repo)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

# App user and code
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
if [ ! -d "$APP_DIR/.git" ]; then git clone -q "$REPO" "$APP_DIR"; fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Dependencies, dashboard build, browser for the cloud worker
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm ci --silent && npm run build -w dashboard --silent && npm run bundle -w worker-web"
(cd "$APP_DIR/worker-web" && npx --yes playwright install-deps chromium >/dev/null)
sudo -u "$APP_USER" bash -c "cd $APP_DIR/worker-web && npx playwright install chromium >/dev/null"

# Caddy: HTTPS on the domain, reverse proxy (incl. WebSocket) to the hub on localhost
sed "s/__HUB_DOMAIN__/$DOMAIN/" "$APP_DIR/deploy/Caddyfile.template" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

# Services
cp "$APP_DIR/deploy/co2lab-hub.service" "$APP_DIR/deploy/co2lab-cloud-worker.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable co2lab-hub co2lab-cloud-worker >/dev/null 2>&1

# Firewall: SSH and web only; the hub port stays private behind Caddy
ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw --force enable >/dev/null

echo "setup done. Copy .env to $APP_DIR/.env, then: systemctl restart co2lab-hub"
