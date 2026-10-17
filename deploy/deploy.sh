#!/usr/bin/env bash
# Run from your laptop (Git Bash) to ship the latest pushed code to the Vultr server:
#   bash deploy/deploy.sh            update code, rebuild, restart
#   bash deploy/deploy.sh --env      also upload .env (server overrides applied)
# Needs VULTR_SERVER_IP (and optionally HUB_DOMAIN) in the root .env, and ~/.ssh/co2lab_vultr.
set -euo pipefail
cd "$(dirname "$0")/.."

getenv() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r'; }
IP="$(getenv VULTR_SERVER_IP)"; [ -n "$IP" ] || { echo "Set VULTR_SERVER_IP in .env"; exit 1; }
DOMAIN="$(getenv HUB_DOMAIN)"; [ -n "$DOMAIN" ] || DOMAIN="${IP//./-}.sslip.io"
SSH=(ssh -i ~/.ssh/co2lab_vultr -o StrictHostKeyChecking=accept-new "root@$IP")

if [ "${1:-}" = "--env" ]; then
  # Same secrets as local, with the server's public URL; the hub listens on localhost behind Caddy
  # and the cloud worker talks to it directly.
  grep -vE '^(HUB_PUBLIC_URL|HUB_HOST|WORKER_HUB_URL)=' .env | tr -d '\r' > /tmp/co2lab.env.server
  printf 'HUB_PUBLIC_URL=https://%s\nHUB_HOST=127.0.0.1\nWORKER_HUB_URL=http://127.0.0.1:8787\n' "$DOMAIN" >> /tmp/co2lab.env.server
  scp -q -i ~/.ssh/co2lab_vultr /tmp/co2lab.env.server "root@$IP:/opt/co2lab/.env"
  rm -f /tmp/co2lab.env.server
  "${SSH[@]}" "chown co2lab:co2lab /opt/co2lab/.env && chmod 600 /opt/co2lab/.env"
  echo "uploaded .env (HUB_PUBLIC_URL=https://$DOMAIN)"
fi

"${SSH[@]}" "cd /opt/co2lab && sudo -u co2lab git pull -q --ff-only && sudo -u co2lab npm ci --silent && sudo -u co2lab npm run build -w dashboard --silent && sudo -u co2lab npm run bundle -w worker-web && systemctl restart co2lab-hub && (systemctl restart co2lab-cloud-worker || true)"
echo "deployed to https://$DOMAIN"
