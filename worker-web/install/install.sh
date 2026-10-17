#!/bin/sh
# CO2LAB worker installer for macOS and Linux. The hub serves this file with its own URL filled in.
#   curl -fsSL __HUB_URL__/install.sh | sh
# Same steps as install.ps1: find or download Node 24, fetch the prebuilt worker into ~/.co2lab/worker,
# optionally start it at login (systemd user service or LaunchAgent), then pair and run.
# CO2LAB_AUTOSTART=1|0 skips the question.
set -eu

HUB='__HUB_URL__'
ROOT="$HOME/.co2lab"
APP="$ROOT/worker"
NODE_DIR="$ROOT/node"

say() { printf '\033[32mco2lab:\033[0m %s\n' "$*"; }
die() { printf 'co2lab: %s\n' "$*" >&2; exit 1; }
node_major() { "$1" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0; }

find_node() {
  if [ -x "$NODE_DIR/bin/node" ] && [ "$(node_major "$NODE_DIR/bin/node")" -ge 22 ]; then echo "$NODE_DIR/bin/node"; return; fi
  if command -v node >/dev/null 2>&1 && [ "$(node_major "$(command -v node)")" -ge 22 ]; then command -v node; return; fi
}

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

install_node() {
  case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) die "unsupported OS $(uname -s)" ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) die "unsupported CPU $(uname -m)" ;; esac
  v="$(curl -fsSL https://nodejs.org/dist/index.json | tr '{' '\n' | grep '"lts":"' | grep -o '"version":"v24\.[0-9.]*"' | head -1 | cut -d'"' -f4)"
  [ -n "$v" ] || die "could not find a Node 24 LTS release on nodejs.org"
  name="node-$v-$os-$arch"
  say "Downloading Node $v ($os-$arch) from nodejs.org ..." >&2
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/$v/$name.tar.gz" -o "$tmp/$name.tar.gz"
  want="$(curl -fsSL "https://nodejs.org/dist/$v/SHASUMS256.txt" | grep " $name.tar.gz\$" | cut -d' ' -f1)"
  [ -n "$want" ] && [ "$(sha256 "$tmp/$name.tar.gz")" = "$want" ] || die "Node download checksum mismatch"
  tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
  rm -rf "$NODE_DIR"; mkdir -p "$ROOT"; mv "$tmp/$name" "$NODE_DIR"; rm -rf "$tmp"
  echo "$NODE_DIR/bin/node"
}

NODE="$(find_node || true)"
[ -n "$NODE" ] || NODE="$(install_node)"
say "Using Node $("$NODE" --version) at $NODE"

say "Downloading the worker from $HUB ..."
mkdir -p "$APP"
tgz="$(mktemp)"
curl -fsSL "$HUB/install/worker.tgz" -o "$tgz"
# Replace the code but keep .device.json (this computer's token).
rm -rf "$APP/worker.mjs" "$APP/node_modules" "$APP/package.json"
tar -xzf "$tgz" -C "$APP"
rm -f "$tgz"

# Restarts the worker if it stops; exit code 3 means the hub rejected this device, so stop then.
cat > "$APP/start-worker.sh" <<EOF
#!/bin/sh
cd "$APP"
while :; do
  "$NODE" worker.mjs --hub "$HUB"
  [ \$? -eq 3 ] && exit 3
  sleep 5
done
EOF
chmod +x "$APP/start-worker.sh"

auto="${CO2LAB_AUTOSTART:-}"
if [ -z "$auto" ]; then
  if [ -r /dev/tty ]; then
    printf 'Start the CO2LAB worker automatically when you log in? [Y/n] '
    read -r ans </dev/tty || ans=""
  else ans=""; fi
  case "$ans" in [nN]*) auto=0 ;; *) auto=1 ;; esac
fi
if [ "$auto" = 1 ]; then
  if [ "$(uname -s)" = Darwin ]; then
    plist="$HOME/Library/LaunchAgents/lab.co2.worker.plist"
    mkdir -p "$(dirname "$plist")"
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>lab.co2.worker</string>
  <key>ProgramArguments</key><array><string>$APP/start-worker.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$APP/worker.log</string>
  <key>StandardErrorPath</key><string>$APP/worker.log</string>
</dict></plist>
EOF
    say "It will start when you log in ($plist)."
  elif command -v systemctl >/dev/null 2>&1; then
    unit="$HOME/.config/systemd/user/co2lab-worker.service"
    mkdir -p "$(dirname "$unit")"
    printf '[Unit]\nDescription=CO2LAB worker\n\n[Service]\nExecStart=%s\nRestart=on-failure\nRestartPreventExitStatus=3\n\n[Install]\nWantedBy=default.target\n' "$APP/start-worker.sh" > "$unit"
    systemctl --user daemon-reload && systemctl --user enable co2lab-worker.service >/dev/null 2>&1 || true
    say "It will start when you log in (systemctl --user disable co2lab-worker to stop that)."
  fi
fi

say "Starting the worker. Press Ctrl+C to stop it; run $APP/start-worker.sh to start it again."
cd "$APP"
exec "$NODE" worker.mjs --hub "$HUB"
