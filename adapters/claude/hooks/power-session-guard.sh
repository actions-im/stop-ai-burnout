#!/usr/bin/env bash
set -euo pipefail

workspace="${CLAUDE_PROJECT_DIR:-${POWER_WORKSPACE:-$(pwd)}}"
tool_origin="${POWER_TOOL_ORIGIN:-claude}"

if ! command -v power >/dev/null 2>&1; then
  exit 0
fi

if status_json="$(POWER_WORKSPACE="$workspace" POWER_TOOL_ORIGIN="$tool_origin" power check --json 2>/dev/null)"; then
  mode="$(printf '%s' "$status_json" | node -e 'let data="";process.stdin.on("data",d=>data+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(data).mode));')"
  mission="$(printf '%s' "$status_json" | node -e 'let data="";process.stdin.on("data",d=>data+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(data).mission));')"

  echo "Power Governor: active mode=$mode mission=$mission"

  if [ "$mode" = "Shutdown" ]; then
    echo "Power Governor: session is in Shutdown. Use /power-confirm-shutdown or /power-time-override."
  fi
else
  echo "Power Governor: no active session. Use /power-start before beginning governed work."
fi
