#!/bin/sh
# Keeps the PlotStar web app and the phone gateway running in the background on this Mac, as
# launchd user agents: they start at login and restart if they stop. They pause while the Mac
# sleeps. macOS only.
#
#   npm run mobile:service install     build the web app, then install and start both services
#   npm run mobile:service status      are they running, and where are the logs
#   npm run mobile:service restart     after pulling new code (rebuilds first)
#   npm run mobile:service uninstall   stop both and remove them
#
# The web app stays on 127.0.0.1:3000. The gateway (port 3100) only accepts this Mac and an
# iPhone hotspot's network unless MOBILE_ALLOW says otherwise (see scripts/mobile-gateway.mjs).
# The Tello bridge (bridge/server.py, 127.0.0.1:8010) runs too when its Python packages are
# installed. It keeps reconnecting until the drone is on. Options for install:
#   TELLO_IP=172.20.10.14    the drone's address in station mode on your hotspot (default: its own Wi-Fi)
#   DRONE_PYTHON=/path/to/python   a Python with bridge/requirements.txt (default: bridge/.venv, then python3)
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/PlotStar"
NODE=$(command -v node)
NPM=$(command -v npm)
DOMAIN="gui/$(id -u)"
WEB=dev.plotstar.web
GATEWAY=dev.plotstar.gateway
DRONE=dev.plotstar.drone

write_agent() { # label, log name, program arguments...
  label=$1 log=$2
  shift 2
  args=""
  for a in "$@"; do args="$args<string>$a</string>"; done
  cat >"$AGENTS/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>$args</array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOGS/$log.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$log.log</string>
</dict>
</plist>
EOF
}

build() {
  mkdir -p "$LOGS"
  echo "Building the web app (log: $LOGS/build.log)…"
  "$NPM" run build >"$LOGS/build.log" 2>&1 || { echo "Build failed. See $LOGS/build.log"; exit 1; }
}

state() { # label → running / not running / not installed
  if out=$(launchctl print "$DOMAIN/$1" 2>/dev/null); then
    echo "$out" | sed -n 's/^[[:space:]]*state = //p' | head -1
  else
    echo "not installed"
  fi
}

case "${1:-status}" in
  install)
    mkdir -p "$AGENTS" "$LOGS"
    "$NODE" scripts/mobile-gateway.mjs --ensure-key
    build
    for label in $WEB $GATEWAY; do launchctl bootout "$DOMAIN/$label" 2>/dev/null || true; done
    write_agent $WEB web "$NODE" "$ROOT/node_modules/next/dist/bin/next" start --hostname 127.0.0.1 --port 3000
    write_agent $GATEWAY gateway "$NODE" "$ROOT/scripts/mobile-gateway.mjs" --no-qr
    launchctl bootstrap "$DOMAIN" "$AGENTS/$WEB.plist"
    launchctl bootstrap "$DOMAIN" "$AGENTS/$GATEWAY.plist"
    launchctl bootout "$DOMAIN/$DRONE" 2>/dev/null || true
    PY=${DRONE_PYTHON:-}
    [ -z "$PY" ] && [ -x bridge/.venv/bin/python ] && PY="$ROOT/bridge/.venv/bin/python"
    [ -z "$PY" ] && PY=$(command -v python3)
    if "$PY" -c "import flask, djitellopy, cv2, numpy" 2>/dev/null; then
      if [ -n "${TELLO_IP:-}" ]; then
        write_agent $DRONE drone "$PY" -u "$ROOT/bridge/server.py" --tello-ip "$TELLO_IP"
      else
        write_agent $DRONE drone "$PY" -u "$ROOT/bridge/server.py"
      fi
      launchctl bootstrap "$DOMAIN" "$AGENTS/$DRONE.plist"
      echo "Drone bridge installed (Tello at ${TELLO_IP:-its own Wi-Fi network})."
    else
      echo "Drone bridge skipped: $PY lacks bridge/requirements.txt. Set DRONE_PYTHON and reinstall."
    fi
    echo "Installed. The services start at login and restart if they stop."
    echo "Pair the phone (on your hotspot): npm run mobile:pair"
    ;;
  restart)
    build
    launchctl kickstart -k "$DOMAIN/$WEB"
    launchctl kickstart -k "$DOMAIN/$GATEWAY"
    launchctl kickstart -k "$DOMAIN/$DRONE" 2>/dev/null || true
    echo "Restarted."
    ;;
  uninstall)
    for label in $WEB $GATEWAY $DRONE; do
      launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
      rm -f "$AGENTS/$label.plist"
    done
    echo "Stopped and removed. Logs are kept in $LOGS."
    ;;
  status)
    echo "web app  ($WEB): $(state $WEB)"
    echo "gateway  ($GATEWAY): $(state $GATEWAY)"
    echo "drone    ($DRONE): $(state $DRONE)"
    curl -s -o /dev/null -m 3 -w "web app answers on 127.0.0.1:3000: HTTP %{http_code}\n" http://127.0.0.1:3000/ || echo "web app is not answering on 127.0.0.1:3000"
    curl -s -m 3 http://127.0.0.1:3100/health >/dev/null && echo "gateway answers on port 3100" || echo "gateway is not answering on port 3100"
    curl -s -m 3 http://127.0.0.1:8010/api/status 2>/dev/null | sed 's/^/drone bridge: /' || echo "drone bridge is not answering on 127.0.0.1:8010"
    echo
    echo "Logs: $LOGS"
    ;;
  *)
    echo "usage: npm run mobile:service install|status|restart|uninstall"
    exit 2
    ;;
esac
