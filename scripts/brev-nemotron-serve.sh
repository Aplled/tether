#!/usr/bin/env bash
set -euo pipefail

# Run only inside the provisioned Brev Linux GPU instance.
IMAGE="vllm/vllm-openai:v0.12.0"
MODEL="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16"
MODEL_REVISION="bf77c3174f68ad409e1c2aa60daeb46e32d1c606"
SERVED_MODEL="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16"
PARSER_SHA256="aafb12208054504f619cbdd01837e1532a482ad937ed987bfe9a13fb812ae2b7"
PARSER_URL="https://huggingface.co/${MODEL}/resolve/${MODEL_REVISION}/nano_v3_reasoning_parser.py"
CONTAINER_NAME="tether-nemotron"
PORT="8000"
MAX_MODEL_LEN="16384"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-2}"
WORKSPACE_ROOT="${TETHER_NEMOTRON_ROOT:-${HOME}/workspace/tether-nemotron}"
PRIVATE_DIR="${WORKSPACE_ROOT}/private"
CACHE_DIR="${WORKSPACE_ROOT}/hf-cache"
PARSER_DIR="${WORKSPACE_ROOT}/parser"
STATE_DIR="${WORKSPACE_ROOT}/state"
KEY_FILE="${PRIVATE_DIR}/api-key"
ENV_FILE="${PRIVATE_DIR}/vllm.env"
PARSER_FILE="${PARSER_DIR}/nano_v3_reasoning_parser.py"
DRY_RUN=0

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
elif [[ $# -ne 0 ]]; then
  printf 'Usage: %s [--dry-run]\n' "$0" >&2
  exit 64
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '%s\n' \
    "Remote-only plan; no commands executed." \
    "Image: ${IMAGE}" \
    "Model: ${MODEL}@${MODEL_REVISION}" \
    "Served alias: ${SERVED_MODEL}" \
    "Binding: 127.0.0.1:${PORT}" \
    "Limits: max-model-len=${MAX_MODEL_LEN}, max-num-seqs=${MAX_NUM_SEQS}" \
    "Persistent root: ${WORKSPACE_ROOT}" \
    "API key: generated privately at ${KEY_FILE}"
  exit 0
fi

fail() { printf 'Preflight failed: %s\n' "$1" >&2; exit 1; }
command -v docker >/dev/null || fail "docker is unavailable"
command -v nvidia-smi >/dev/null || fail "nvidia-smi is unavailable"
command -v curl >/dev/null || fail "curl is unavailable"
command -v python3 >/dev/null || fail "python3 is unavailable"
command -v openssl >/dev/null || fail "openssl is unavailable"
[[ "$(uname -s)" == "Linux" ]] || fail "this helper must run on the remote Linux GPU host"
[[ "$MAX_NUM_SEQS" =~ ^[234]$ ]] || fail "MAX_NUM_SEQS must be 2, 3, or 4"

gpu_memory_mib="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n 1 | tr -d ' ')"
[[ "$gpu_memory_mib" =~ ^[0-9]+$ ]] || fail "unable to read GPU memory"
(( gpu_memory_mib >= 78000 )) || fail "an 80 GB GPU is required for this BF16 setup"

available_kib="$(df -Pk "${HOME}" | awk 'NR==2 {print $4}')"
[[ "$available_kib" =~ ^[0-9]+$ ]] || fail "unable to read available disk"
(( available_kib >= 75 * 1024 * 1024 )) || fail "at least 75 GiB free is required before model download"

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  fail "container ${CONTAINER_NAME} already exists; inspect it before replacing anything"
fi
if python3 - "$PORT" <<'PY'
import socket, sys
s = socket.socket()
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    raise SystemExit(0)
else:
    s.close()
    raise SystemExit(1)
PY
then
  fail "127.0.0.1:${PORT} is already in use"
fi

umask 077
mkdir -p "$PRIVATE_DIR" "$CACHE_DIR" "$PARSER_DIR" "$STATE_DIR"
chmod 700 "$PRIVATE_DIR"
if [[ ! -s "$KEY_FILE" ]]; then
  openssl rand -hex 32 >"$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi
{
  printf 'VLLM_API_KEY='
  tr -d '\r\n' <"$KEY_FILE"
  printf '\n'
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"

curl --fail --silent --show-error --location "$PARSER_URL" --output "$PARSER_FILE"
actual_parser_sha="$(sha256sum "$PARSER_FILE" | awk '{print $1}')"
[[ "$actual_parser_sha" == "$PARSER_SHA256" ]] || fail "reasoning parser checksum mismatch"
chmod 600 "$PARSER_FILE"

docker pull --platform linux/amd64 "$IMAGE"
image_digest="$(docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}')"
[[ "$image_digest" == *@sha256:* ]] || fail "pulled image has no repository digest"
printf '%s\n' "$image_digest" >"${STATE_DIR}/vllm-image-digest.txt"
chmod 600 "${STATE_DIR}/vllm-image-digest.txt"
docker run --rm --gpus all --entrypoint nvidia-smi "$image_digest" >/dev/null

docker run --detach \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --gpus all \
  --ipc host \
  --publish "127.0.0.1:${PORT}:8000" \
  --env-file "$ENV_FILE" \
  --volume "${CACHE_DIR}:/root/.cache/huggingface" \
  --volume "${PARSER_FILE}:/opt/tether/nano_v3_reasoning_parser.py:ro" \
  "$image_digest" \
  "$MODEL" \
  --revision "$MODEL_REVISION" \
  --served-model-name "$SERVED_MODEL" \
  --host 0.0.0.0 \
  --port 8000 \
  --dtype bfloat16 \
  --tensor-parallel-size 1 \
  --max-model-len "$MAX_MODEL_LEN" \
  --max-num-seqs "$MAX_NUM_SEQS" \
  --trust-remote-code \
  --async-scheduling \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --reasoning-parser-plugin /opt/tether/nano_v3_reasoning_parser.py \
  --reasoning-parser nano_v3 \
  --disable-log-requests >/dev/null

ready=0
for _ in $(seq 1 90); do
  if curl --fail --silent --show-error \
    --header "Authorization: Bearer $(tr -d '\r\n' <"$KEY_FILE")" \
    "http://127.0.0.1:${PORT}/v1/models" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 5
done
if [[ "$ready" -ne 1 ]]; then
  docker logs --tail 100 "$CONTAINER_NAME" >&2
  fail "vLLM did not become healthy; container retained for inspection"
fi

TETHER_VLLM_KEY_FILE="$KEY_FILE" TETHER_VLLM_MODEL="$SERVED_MODEL" TETHER_VLLM_PORT="$PORT" python3 <<'PY'
import json, os, urllib.request
key = open(os.environ["TETHER_VLLM_KEY_FILE"], encoding="utf-8").read().strip()
body = {
    "model": os.environ["TETHER_VLLM_MODEL"],
    "messages": [{"role": "user", "content": "Call get_incident_summary for incident-retry. Do not answer directly."}],
    "tools": [{"type": "function", "function": {"name": "get_incident_summary", "description": "Read a scoped incident summary", "parameters": {"type": "object", "properties": {"incident_id": {"type": "string"}}, "required": ["incident_id"], "additionalProperties": False}}}],
    "tool_choice": {"type": "function", "function": {"name": "get_incident_summary"}},
    "chat_template_kwargs": {"enable_thinking": False},
    "max_tokens": 256,
    "temperature": 0,
}
request = urllib.request.Request(
    f"http://127.0.0.1:{os.environ['TETHER_VLLM_PORT']}/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
)
with urllib.request.urlopen(request, timeout=120) as response:
    result = json.load(response)
calls = result.get("choices", [{}])[0].get("message", {}).get("tool_calls")
if not calls or calls[0].get("function", {}).get("name") != "get_incident_summary":
    raise SystemExit("tool-call verification failed")
PY

printf '%s\n' \
  "vLLM health and forced tool-call checks passed." \
  "The API remains bound to remote loopback only." \
  "Use the documented Brev SSH port forward before configuring Tether."
