#!/bin/bash
# Stops services started by scripts/start-demo.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DIR="$PROJECT_ROOT/.run"

stop_pid_file() {
  local name="$1"
  local pid_file="$2"

  if [ ! -f "$pid_file" ]; then
    echo "SKIP $name no pid file"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "SKIP $name stale pid $pid"
    rm -f "$pid_file"
    return 0
  fi

  echo "STOP $name pid $pid"
  kill "$pid" >/dev/null 2>&1 || true

  local i
  for ((i = 1; i <= 10; i += 1)); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$pid_file"
      return 0
    fi
    sleep 1
  done

  echo "KILL $name pid $pid"
  kill -9 "$pid" >/dev/null 2>&1 || true
  rm -f "$pid_file"
}

stop_pid_file "frontend" "$RUN_DIR/frontend.pid"
stop_pid_file "backend" "$RUN_DIR/backend.pid"
stop_pid_file "industrial-gateway" "$RUN_DIR/industrial-gateway.pid"

echo "Demo services stopped."
