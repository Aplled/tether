# Brev Nemotron setup for Tether

This is an optional remote inference path. Nothing in this repository provisions an instance, spends credits, installs global software, or authenticates to Brev. The helper has not been executed on a GPU host. Tether must continue to report rule-based mode until the remote health and tool-call checks pass and an actual application request returns valid tool evidence.

## 1. Create and inspect the instance

In Brev, create one instance named `tether-nemotron` with one A100 80 GB. Prefer a displayed price no higher than $3/hour; a more expensive H100 80 GB requires a shorter running window within the credit budget. Use a standard CUDA/PyTorch VM, at least 150 GB disk, and one instance. The user selected an A100 80 GB Hyperstack listing at $1.62/hour with 850 GB disk included, marked pre-release and no stop/start. That screenshot is a selection checkpoint, not evidence of provisioning or guaranteed availability. A no-stop/start instance must stay running or be terminated, losing its disk. Keep it funded through judging and terminate it afterward.

On the Mac, follow NVIDIA's [Brev CLI installation and authentication instructions](https://docs.nvidia.com/brev/latest/cli/getting-started). The expected flow is:

```bash
brew install brevdev/homebrew-brev/brev
brev login
brev refresh
brev shell tether-nemotron
```

Inside the remote shell, confirm the assigned hardware and both relevant filesystems before downloading anything. Brev/Hyperstack images commonly use a generic remote account such as `shadeform`; use `$HOME` rather than assuming its absolute home path.

```bash
nvidia-smi
docker version
docker info
df -h "$HOME" /ephemeral
```

The helper requires Linux, Docker, NVIDIA container access, and an approximately 80 GB GPU. It checks the filesystem containing the configured model workspace for at least 75 GiB free, then checks Docker's own root filesystem separately for at least 20 GiB free for the vLLM image and layers. It does not assume `$HOME` holds the model cache and does not create or alter mounts. These are abort floors rather than sizing recommendations. If Brev's image does not already provide the NVIDIA container runtime, use NVIDIA's official installation/configuration steps rather than an unreviewed installer: [NVIDIA Container Toolkit install guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

## 2. Put the repository on the remote host

Copy just the setup helper from the Mac, using the SSH alias created by `brev refresh`. This avoids configuring GitHub credentials on the GPU host. In a Mac terminal at the Tether repository root:

```bash
scp scripts/brev-nemotron-serve.sh tether-nemotron:~/brev-nemotron-serve.sh
brev shell tether-nemotron
```

Do not copy `.env.local`, bootstrap account credentials, Supabase credentials, production keys, or other local runtime state. On the selected Hyperstack host, `/ephemeral` is the large attached filesystem. Keep the model cache there by setting the workspace explicitly. In the remote shell, inspect the plan first:

```bash
TETHER_NEMOTRON_ROOT=/ephemeral/tether-nemotron bash ~/brev-nemotron-serve.sh --dry-run
```

Then run it only on the verified remote GPU host:

```bash
TETHER_NEMOTRON_ROOT=/ephemeral/tether-nemotron bash ~/brev-nemotron-serve.sh
```

The helper uses:

- `vllm/vllm-openai:v0.12.0`, then records the pulled repository digest;
- `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` at revision `bf77c3174f68ad409e1c2aa60daeb46e32d1c606`;
- NVIDIA's reasoning parser at the same revision, with SHA-256 `aafb12208054504f619cbdd01837e1532a482ad937ed987bfe9a13fb812ae2b7`;
- the official `qwen3_coder` tool parser and `nano_v3` reasoning parser;
- a conservative 16,384-token context and two concurrent sequences by default. Set `MAX_NUM_SEQS=3` or `4` only after measuring available memory.

With the Hyperstack command above, the model cache persists under `/ephemeral/tether-nemotron/hf-cache`. The generated API key is stored at `/ephemeral/tether-nemotron/private/api-key` with private permissions and is never printed. If another provider exposes a different large persistent filesystem, set `TETHER_NEMOTRON_ROOT` to a directory on that filesystem after inspecting it. The helper supplies it through the documented `VLLM_API_KEY` environment variable; it does not place the key in the container command arguments. The container binds port 8000 to remote `127.0.0.1` only. Root-equivalent Docker users can still inspect container environment and process state; treat access to the instance as trusted administrator access.

The helper will not replace an existing container or occupied port. It verifies the parser checksum, container GPU access, authenticated `/v1/models`, and a forced OpenAI-compatible tool call. A failed check leaves the container available for inspection and does not authorize a live-provider claim.

The pinned Nemotron tokenizer enables thinking by default. With Tether's shared 30-second run deadline, six-call budget, and 1,500-token output cap, unrestricted reasoning can consume the latency and token budget before the tool workflow finishes. vLLM 0.12.0 accepts request-level `chat_template_kwargs`, but its tagged server CLI does not expose the newer `--default-chat-template-kwargs` option. Tether's provider request should therefore include this top-level vLLM extension on every chat-completion call:

```json
{"chat_template_kwargs":{"enable_thinking":false}}
```

The helper's forced tool-call check includes that value. Do not add a server flag that vLLM 0.12.0 does not support. If a later pinned vLLM version adds a reviewed server default, revalidate tool parsing and latency before changing it.

The pinned deployment choices come from the [vLLM/NVIDIA Nemotron recipe](https://github.com/vllm-project/recipes/blob/main/NVIDIA/Nemotron-3-Nano-30B-A3B.md) and the [NVIDIA model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16). vLLM documents the API key and served-model controls in its [OpenAI-compatible server documentation](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html).

## 3. Forward remote loopback to the Mac

Keep the Brev instance API private and create the SSH forward described in NVIDIA's [Brev connectivity documentation](https://docs.nvidia.com/brev/cli/connectivity) on the Mac:

```bash
brev port-forward tether-nemotron --port 8000:8000
```

Leave that process running. In a second Mac terminal at the repository root, copy the generated key through the authenticated SSH connection without printing it, then verify the tunnel:

```bash
umask 077
mkdir -p .runtime/tether
scp tether-nemotron:/ephemeral/tether-nemotron/private/api-key .runtime/tether/nemotron-api-key
chmod 600 .runtime/tether/nemotron-api-key
curl --fail --silent \
  -H "Authorization: Bearer $(<.runtime/tether/nemotron-api-key)" \
  http://127.0.0.1:8000/v1/models
```

Do not expose port 8000 on a public interface or add a cloud firewall rule for it.

## 4. Configure Tether locally

After copying the key, configure the local backend from the project root without displaying or manually pasting the secret:

```bash
./scripts/dev.sh run brev:configure
```

The helper checks the fixed key path and its permissions, then writes `.env.local` privately while preserving unrelated settings. It never prints the key. For reference, [.env.brev.example](../.env.brev.example) lists the resulting settings:

```dotenv
NVIDIA_BASE_URL=http://127.0.0.1:8000/v1
NVIDIA_MODEL=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16
NVIDIA_API_KEY=<private generated key>
```

The model value must exactly match the served alias. Keep the key in the local backend process only; never put it in browser JavaScript, screenshots, chat, committed files, or logs. Restart the Tether server after changing its environment.

Run one explicit analysis from the product and inspect the returned provider/model/mode and real tool evidence. A configured key, healthy model list, or standalone curl response is not enough to label the application run live. If the tunnel, model, parser, or tool call fails, retain the truthful rule-based fallback.

## 5. Operations and cleanup

Inspect without exposing secrets:

```bash
docker ps --filter name=tether-nemotron
docker logs --tail 100 tether-nemotron
nvidia-smi
```

Stop compute billing when the presentation work is done using Brev's current UI or CLI workflow. Preserve the model cache only if the storage cost and future need are understood. Rotating the API key requires replacing the container with a newly generated private key; do not edit or disclose the old key in command output.

Known limits: this configuration is single-GPU, single-instance, loopback-only, and intended for a bounded presentation workflow. It has no autoscaling, high availability, TLS termination, production monitoring, or production secret manager. The 16k context and concurrency limit are conservative choices for the A100 80 GB target and still require an actual measured run.
