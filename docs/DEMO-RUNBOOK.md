# Historical web prototype

This page documents the older `apps/demo-web` prototype. For the current authenticated Tether company app, use [TETHER-RUNBOOK.md](TETHER-RUNBOOK.md). The limitations below describe this older fixture, not the replacement company graph and login system.

## Start

```sh
./scripts/dev.sh run demo:web:legacy
```

Open <http://127.0.0.1:4173> when the current Tether server is stopped, or choose a different legacy port. The server binds only to this Mac's loopback interface. Northstar Compute is the synthetic workspace; the current product name is Tether.

## Short rehearsal

1. Show the connected services, owner, monitor, and backup runbook. Pan, zoom, fit, move, add/edit, and connect nodes.
2. Click **Run response** to load the fictional scheduler warning and inspect the proposal. **Report incident** on a selected node accepts a custom title and observation.
3. Show the planner source. Without an NVIDIA key, the planner is explicitly scripted while its six read/simulation calls still use the real scoped MCP bridge.
4. Click **Review & approve**. Review the exact `pantry-demo-scheduler` target and displayed digest. The Northstar presentation retains this legacy disposable fixture identifier.
5. Confirm. The existing policy checks approve one exact action, the broker stops its own disposable scheduler, and the independent observer requires the scheduler to be unreachable while the control process remains reachable.
6. Click **Verify & activate fallback**. The server writes and validates fictional local artifacts, hashes them, verifies canonical task evidence, and changes the canonical incident to `running_on_fallback`.
7. Open **Activity** to inspect verified tasks and send a local handoff message. Open **People** to distinguish an owner from the eligible fictional commander.
8. Click **Reset demo** before another rehearsal. Reset creates a fresh broker, policy, and canonical fixture. Server restart preserves canvas edits but clears stale execution/proposal claims.

## Optional live Nemotron

Copy `.env.example` to project-root `.env.local`, then set `NVIDIA_API_KEY` locally. Restart the demo server. Never paste the key into chat or browser assets. A configured key alone does not prove a live run; require the visible live result and actual returned tool evidence. Provider errors, invalid output, or timeout fall back to a labeled scripted plan.

`NVIDIA_MODEL` and `NVIDIA_BASE_URL` are configurable for a supported NVIDIA endpoint or separately provisioned NIM. No cloud instance was provisioned and no Brev credits were spent for this work. See [model documentation](DEMO-MODELS.md) for exact primary sources and bounds. Jev is not implemented and is not needed for this demo.

## What is and is not proven

- Canvas edits and local messages persist. Presented dependency paths can be explored, but arbitrary canvas edits are not synchronized into the fixed deterministic containment fixture. An incident on an unrelated node cannot produce a scheduler stop proposal.
- The response path uses real MCP, canonical proposals, exact digest binding, real local process effects, independent observation, and verified synthetic fallback artifacts.
- Approval is a fictional localhost persona ceremony. Another process under the same user can obtain the page token and impersonate that persona. This is not production human authentication or protection from a compromised host.
- Only the broker-owned scheduler is stopped. This is not machine, network, malware, or production isolation.
- SQLite, demo artifacts, and key files are plaintext synthetic local storage.
- The mesh panel references previously saved protocol evidence. Ordinary browser handoff messages are local workspace messages, not encrypted peer transport. The real mesh tests cover three processes on one Mac, not physical/radio mesh.
- The NVIDIA adapter is implemented and tested against controlled responses, but actual provider inference remains unverified until a usable key and model run succeed. Scripted mode alone does not fulfill the NVIDIA track's Nemotron-use requirement.

## Checks

```sh
./scripts/dev.sh run typecheck
./scripts/dev.sh run demo:web:check
./scripts/dev.sh test
```

Verified November 7: 9 web/model tests and 60 original backend tests pass. HTTP integration covers rejected actor/digest, real containment facts, canonical fallback, reset, and restart claim clearing. Browser checks cover node creation, connection creation, incident response, approval, fallback, and handoff message input. Historical backend/mesh evidence remains in `docs/evidence/VERIFICATION.json`; it has not been overwritten as proof of live NVIDIA use.
