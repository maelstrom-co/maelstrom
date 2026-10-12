#!/usr/bin/env bash
# PROTOTYPE (MAE-826): throwaway measurement runner, never merge.
# Starts a fresh local ws-server with the given Planner and tool-call flags,
# runs the headless smoke for one prompt, and keeps both logs.
# Usage, from apps/demo:
#   prototype-mae826/run-journey.sh <label> <AGENT_PLANNER> <AGENT_PARALLEL_TOOLS> "<prompt>" [port]
# Logs land in prototype-mae826/results/raw/<label>.server.log and .smoke.log.
set -euo pipefail

label=$1
planner=$2
parallel=$3
prompt=$4
port=${5:-3051}
out=prototype-mae826/results/raw
mkdir -p "$out"

AGENT_PLANNER=$planner AGENT_PARALLEL_TOOLS=$parallel WS_PORT=$port \
  bun --env-file=../../.env run src/server/ws-server.ts \
  >"$out/$label.server.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT

for _ in $(seq 1 100); do
  grep -q 'listening on' "$out/$label.server.log" && break
  sleep 0.1
done

WS_URL="ws://localhost:$port/ws" \
  bun run prototype-mae825/agent-session-smoke.ts "$prompt" \
  >"$out/$label.smoke.log" 2>&1 &
smoke=$!
trap 'kill $server $smoke 2>/dev/null || true' EXIT

# The smoke's 180 s turn-timeout timer keeps it alive after the turn ends.
for _ in $(seq 1 1900); do
  grep -qE '^final cart|TURN TIMEOUT' "$out/$label.smoke.log" && break
  kill -0 $smoke 2>/dev/null || break
  sleep 0.1
done
sleep 0.5
