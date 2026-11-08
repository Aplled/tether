# Demo model integration

The demo server can call NVIDIA NIM through `apps/demo-web/agent.ts`. Set `NVIDIA_API_KEY` in the server environment to enable live requests. `NVIDIA_BASE_URL` defaults to `https://integrate.api.nvidia.com/v1`, and `NVIDIA_MODEL` defaults to the currently documented tool-capable hosted model `nvidia/nemotron-3.5-super-vl-120b-a12b`. The earlier `nvidia/nemotron-3-nano-30b-a3b` model remains downloadable or partner-hosted, but NVIDIA labels its free hosted endpoint deprecated, so it is not the default.

The adapter uses NVIDIA's OpenAI-compatible `POST /v1/chat/completions` format. Assistant tool calls are returned in `tool_calls`; each result is appended as a `tool` message with the matching `tool_call_id`. Primary references:

- NVIDIA NIM LLM API index: <https://docs.api.nvidia.com/nim/reference/llm-apis>
- NVIDIA chat-completion and tool-call format: <https://docs.api.nvidia.com/nim/reference/stepfun-ai-step-5-preview-infer>
- NVIDIA Nemotron 3.5 Super hosted API and tool schema: <https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-super-vl-120b-a12b-infer>
- NVIDIA Nemotron 3 Nano model card and availability: <https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b>

The adapter allows only seven incident read/simulation tools and caps a run at six tool calls, 30 seconds, and 32 KiB of serialized request/result data. Organization and incident identifiers come from trusted server context and replace model-supplied values. Model text and tool results remain untrusted data. The model cannot submit, approve, or execute an action. A valid provider response is required before the UI can report `mode: "live"`; provider errors, invalid output, or missing configuration use the explicit deterministic `mode: "scripted"` fallback.

The tool callback is intentionally a same-process adapter over bounded local workflows. It receives the shared abort signal as its third argument and must pass that signal and the remaining timeout to the MCP request. Provider fetches and active tool calls therefore share one 30-second deadline. The adapter never races a callback in a way that would leave work running after return.

The NVIDIA API key stays in the server process. The adapter does not log it or return it. Do not expose this module directly to browser code.

## TypeSafe AI / Jev

Jev classification is not implemented in this demo adapter. The proposed use is limited to triage labels (`incident`, `question`, or `note`) with an `unknown` confidence fallback; classification would never grant permission or bypass server policy. No TypeSafe AI response or integration should be claimed in the demo until a primary API specification, credentials, and an actual bounded call are verified.

The verified primary starting point is TypeSafe AI's documentation at <https://docs.typesafe.ai/introduction>. Search results also contain unrelated lookalike domains; credentials must never be sent to a host inferred from search results. A future integration must take its exact endpoint and authentication scheme from TypeSafe AI's primary documentation.
