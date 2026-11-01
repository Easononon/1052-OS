#!/bin/bash
# 1052-OS Industrial Gateway — Start Script
# Launches gateway REST API on port 18765 by default, matching the 10055 Vite proxy.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
GATEWAY_DIR="$PROJECT_DIR/gateway_python"
RUN_DIR="$PROJECT_DIR/.run"
LOG_DIR="$PROJECT_DIR/logs"
GATEWAY_PORT="${GATEWAY_PORT:-18765}"
GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
NODERED_PORT="${NODERED_PORT:-1885}"
PID_FILE="$RUN_DIR/industrial-gateway.pid"
LOG_FILE="$LOG_DIR/industrial-gateway.log"

cd "$GATEWAY_DIR"
mkdir -p "$RUN_DIR" "$LOG_DIR"

if [ ! -d ".venv" ]; then
    echo "ERROR: virtualenv not found. Run: cd gateway_python && uv sync"
    exit 1
fi

if lsof -nP -iTCP:"$GATEWAY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Industrial Gateway already listening on ${GATEWAY_HOST}:${GATEWAY_PORT}"
    curl -s "http://${GATEWAY_HOST}:${GATEWAY_PORT}/api/health" | python3 -m json.tool 2>/dev/null || true
    exit 0
fi

echo "Starting 1052-OS Industrial Gateway on ${GATEWAY_HOST}:${GATEWAY_PORT} ..."
GATEWAY_API_URL="http://${GATEWAY_HOST}:${GATEWAY_PORT}" \
NODERED_PORT="$NODERED_PORT" \
GATEWAY_DISABLE_AUTOCONNECT="${GATEWAY_DISABLE_AUTOCONNECT:-1}" \
nohup .venv/bin/python -m uvicorn gateway.server:app --host "$GATEWAY_HOST" --port "$GATEWAY_PORT" > "$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"
echo "Gateway PID: $(cat "$PID_FILE")"
echo "Log: $LOG_FILE"
sleep 2
curl -s "http://${GATEWAY_HOST}:${GATEWAY_PORT}/api/health" | python3 -m json.tool 2>/dev/null || echo "Waiting for startup..."
