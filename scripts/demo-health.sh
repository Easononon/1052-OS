#!/bin/bash
# Prints local 1052 demo service health.
set -euo pipefail

FRONTEND_PORT="${FRONTEND_PORT:-10055}"
BACKEND_PORT="${BACKEND_PORT:-10053}"
GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-18765}"
NODERED_PORT="${NODERED_PORT:-1885}"

check_http() {
  local name="$1"
  local url="$2"
  if body="$(curl -fsS "$url" 2>/dev/null)"; then
    echo "OK  $name $url"
    if [ -n "$body" ]; then
      echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body" | head -c 240
      echo
    fi
  else
    echo "ERR $name $url"
  fi
}

check_port() {
  local name="$1"
  local port="$2"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "OK  $name listening on :$port"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN
  else
    echo "ERR $name not listening on :$port"
  fi
}

check_port "frontend" "$FRONTEND_PORT"
check_port "backend" "$BACKEND_PORT"
check_port "industrial-gateway" "$GATEWAY_PORT"
check_port "node-red" "$NODERED_PORT"

echo
check_http "backend" "http://127.0.0.1:$BACKEND_PORT/api/health"
check_http "gateway" "http://$GATEWAY_HOST:$GATEWAY_PORT/api/health"
check_http "gateway-node-red" "http://$GATEWAY_HOST:$GATEWAY_PORT/api/nodered/runtime"
check_http "frontend-proxy-gateway" "http://127.0.0.1:$FRONTEND_PORT/industrial-gateway/api/health"
