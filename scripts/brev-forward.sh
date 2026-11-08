#!/usr/bin/env bash
set -u

# Keep the already-provisioned model reachable through a private SSH forward.
# This never provisions an instance, opens a cloud port, or changes SSH policy.
command -v ssh >/dev/null || exit 1
if command -v lsof >/dev/null && lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  printf '%s\n' 'Local port 8000 is already in use. Keep the existing forward or stop its owner before starting this one.' >&2
  exit 1
fi
child_pid=''
stopping=0
cleanup() {
  stopping=1
  if [[ -n "$child_pid" ]]; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT
printf '%s\n' 'Connecting the model on 127.0.0.1:8000. Network interruptions will be retried; Ctrl+C stops this forward.'
delay=3
while [[ "$stopping" -eq 0 ]]; do
  started=$SECONDS
  ssh -NT \
    -o ForkAfterAuthentication=no -o ControlMaster=no -o ControlPath=none \
    -o BatchMode=yes -o ConnectTimeout=15 -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=2 \
    -L 127.0.0.1:8000:127.0.0.1:8000 tether-nemotron &
  child_pid=$!
  wait "$child_pid" || true
  child_pid=''
  [[ "$stopping" -eq 0 ]] || break
  if (( SECONDS - started > 60 )); then delay=3; fi
  printf 'Model connection interrupted; retrying in %s seconds.\n' "$delay" >&2
  sleep "$delay" &
  child_pid=$!
  wait "$child_pid" || true
  child_pid=''
  if (( delay < 20 )); then
    delay=$((delay + 3))
    (( delay > 20 )) && delay=20
  fi
done
