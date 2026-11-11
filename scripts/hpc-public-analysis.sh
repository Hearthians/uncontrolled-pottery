#!/usr/bin/env bash
#SBATCH --job-name=pottery-public-api
#SBATCH --partition=i64m512u
#SBATCH --qos=i64m512u
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=2
#SBATCH --mem=4G
#SBATCH --time=7-00:00:00

set -euo pipefail
umask 077
ROOT="$HOME/work/uncontrolled-pottery"
SERVICE="$ROOT/.runtime/public-analysis-service"
export MEMORY_ANALYSIS_PROVIDER=minimax
export MEMORY_ANALYSIS_PUBLIC=1
export MEMORY_ANALYSIS_PUBLIC_ORIGIN=https://gfyh.fun
export MEMORY_ANALYSIS_BUDGET_MODE=gateway
export MEMORY_ANALYSIS_API_KEY="$(<"$ROOT/.runtime/public-analysis-secrets/minimax.key")"
export MEMORY_ANALYSIS_FALLBACK_API_KEY="$(<"$ROOT/.runtime/public-analysis-secrets/gpt.key")"
export PORT=5187
cd "$SERVICE"
"$HOME/.local/bin/node" --experimental-strip-types server/index.ts &
server_pid=$!
cleanup() { kill "$server_pid" 2>/dev/null || :; if [[ -n "${tunnel_pid:-}" ]]; then kill "$tunnel_pid" 2>/dev/null || :; fi; }
trap cleanup EXIT INT TERM
for ((i=0; i<30; i++)); do
  if curl -fsS -o /dev/null http://127.0.0.1:5187/pottery/; then break; fi
  kill -0 "$server_pid" || exit 1
  sleep 1
done
"$HOME/.local/bin/node" "$ROOT/scripts/hpc-public-smoke.mjs"
ssh -N -T -i "$HOME/.ssh/id_ed25519_hpc_peers" -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -R 127.0.0.1:15174:127.0.0.1:5187 lizd@gfyh.fun &
tunnel_pid=$!
wait -n "$server_pid" "$tunnel_pid"
