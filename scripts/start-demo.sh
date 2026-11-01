#!/bin/bash
# 1052-OS local demo starter.
# Starts backend (:10053), frontend (:10055), and Industrial Gateway (:18765).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DIR="$PROJECT_ROOT/.run"
LOG_DIR="$PROJECT_ROOT/logs"

FRONTEND_PORT="${FRONTEND_PORT:-10055}"
BACKEND_PORT="${BACKEND_PORT:-10053}"
GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-18765}"
NODERED_PORT="${NODERED_PORT:-1885}"
DATA_DIR="${DATA_DIR:-$PROJECT_ROOT/data}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

port_is_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

wait_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-30}"
  local i
  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "OK  $name -> $url"
      return 0
    fi
    sleep 1
  done
  echo "ERR $name did not become healthy -> $url"
  return 1
}

start_backend() {
  local pid_file="$RUN_DIR/backend.pid"
  local log_file="$LOG_DIR/backend-10053.log"

  if port_is_listening "$BACKEND_PORT"; then
    echo "SKIP backend already listening on :$BACKEND_PORT"
    return 0
  fi

  echo "START backend on :$BACKEND_PORT"
  (
    cd "$PROJECT_ROOT/backend"
    PORT="$BACKEND_PORT" DATA_DIR="$DATA_DIR" nohup npm run dev > "$log_file" 2>&1 &
    echo $! > "$pid_file"
  )
  echo "  pid: $(cat "$pid_file")"
  echo "  log: $log_file"
}

start_frontend() {
  local pid_file="$RUN_DIR/frontend.pid"
  local log_file="$LOG_DIR/frontend-10055.log"

  if port_is_listening "$FRONTEND_PORT"; then
    echo "SKIP frontend already listening on :$FRONTEND_PORT"
    return 0
  fi

  echo "START frontend on :$FRONTEND_PORT"
  (
    cd "$PROJECT_ROOT/frontend"
    VITE_GATEWAY_TARGET="http://$GATEWAY_HOST:$GATEWAY_PORT" \
      nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" > "$log_file" 2>&1 &
    echo $! > "$pid_file"
  )
  echo "  pid: $(cat "$pid_file")"
  echo "  log: $log_file"
}

start_gateway() {
  local pid_file="$RUN_DIR/industrial-gateway.pid"
  local log_file="$LOG_DIR/industrial-gateway.log"

  if port_is_listening "$GATEWAY_PORT"; then
    echo "SKIP industrial gateway already listening on :$GATEWAY_PORT"
    return 0
  fi

  if [ ! -d "$PROJECT_ROOT/gateway_python/.venv" ]; then
    echo "ERR gateway virtualenv missing. Run: cd gateway_python && uv sync"
    return 1
  fi

  echo "START industrial gateway on $GATEWAY_HOST:$GATEWAY_PORT, Node-RED :$NODERED_PORT"
  (
    cd "$PROJECT_ROOT/gateway_python"
    GATEWAY_API_URL="http://$GATEWAY_HOST:$GATEWAY_PORT" \
      NODERED_PORT="$NODERED_PORT" \
      GATEWAY_DISABLE_AUTOCONNECT="${GATEWAY_DISABLE_AUTOCONNECT:-1}" \
      nohup .venv/bin/python -m uvicorn gateway.server:app --host "$GATEWAY_HOST" --port "$GATEWAY_PORT" > "$log_file" 2>&1 &
    echo $! > "$pid_file"
  )
  echo "  pid: $(cat "$pid_file")"
  echo "  log: $log_file"
}

start_backend
start_gateway
start_frontend

echo
echo "Health check:"
wait_http "backend" "http://127.0.0.1:$BACKEND_PORT/api/health" 20 || true
wait_http "gateway" "http://$GATEWAY_HOST:$GATEWAY_PORT/api/health" 20 || true
wait_http "frontend" "http://127.0.0.1:$FRONTEND_PORT" 20 || true

echo
echo "Open:"
echo "  1052 OS:             http://127.0.0.1:$FRONTEND_PORT/today"
echo "  Industrial Gateway:  http://127.0.0.1:$FRONTEND_PORT/industrial-gateway"
echo
echo "Stop with:"
echo "  ./scripts/stop-demo.sh"
