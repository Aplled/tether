# Tether walkthrough

Tether uses synthetic Northstar Compute records and isolated local infrastructure. The normal product surface omits rehearsal labels, while this document preserves the provenance and limits.

## Start and sign in

```sh
./scripts/dev.sh run tether:web
```

Open <http://127.0.0.1:4173>. The runtime uses the project's private Node 26.13.0, loopback HTTP, local SQLite, and authenticated per-user event streams. It does not use the unrelated connected Supabase project. Runtime data persists in `.runtime/tether`; never commit or distribute that directory.

Generated setup credentials are in `.runtime/tether/bootstrap-accounts.json`, mode 0600. The four emails are `ava@northstar.local`, `noah@northstar.local`, `priya@northstar.local`, and `elena@northstar.local`. Open each in a separate tab. Each tab stores its own bearer token in sessionStorage, so signing out in one does not replace the others' identities. This is convenience isolation for the presentation, not protection against same-origin malicious JavaScript.

## Setup through response

1. As Ava, show the ordinary company canvas and directory before creating an incident. Add an employee and a system, assign an owner, connect a dependency, and reload to confirm persistence. Inspect CSV/catalog imports through server validation and explicit commit. Import is a snapshot; it does not create a maintained live connector or grant credentials.
2. Open the four views. Noah sees relevant software systems; Priya sees her training/data scope. Elena receives ordinary permitted context and no private security workspace.
3. Report the observation: a customer retry was accepted for another customer's GPU job. Select suspected nodes, not a claimed confirmed root cause, and create a response workspace. Include Noah and Priya under Ava's coordination.
4. Start analysis explicitly. Inspect the actual provider label and tool evidence. `scripted` means the rule-based backup, not live Nemotron. Read the concrete retry endpoint, tenant authorization, retry queue, GPU scheduler, DFW worker pool, and downstream training effects.
5. Assign scoped tasks, exchange messages, acknowledge work, and review each engineer's coding-agent prompt before copying. A brief can become stale after evidence, source, assignment, or permission changes. Copying it does not grant the external agent repository or infrastructure access.
6. Review the exact `disable_cross_tenant_retry` operation on `northstar-retry-api` with its current target generation and digest. Only the current authorized commander can approve. Layout dragging is not a semantic change; relevant dependency/evidence/grant changes invalidate approval.
7. Confirm independent observation of the disabled route and healthy control, then verify the existing safe fallback route. Require same-tenant retry success and cross-tenant denial before resolution. This verifies a prebuilt alternative; it does not deploy another service or dynamically switch production routing. A network error or model assertion is not verification.
8. In Elena's view, show the approved general notice and responder names without the exploit, private conversation, repository paths, task content, or hidden incident identifier.

After-hours preferences default off; the synthetic Ava account starts with an explicitly configured accepted on-call window. A manager's title does not require overnight work. The coverage check explains current authorized candidates and why others are ineligible, without promoting anyone. It is a manual, point-in-time eligibility check: there is no background pager, acknowledgment timeout, retry loop, or outbound email/SMS/push delivery. Saved notifications appear only inside the app. A user who voluntarily opens the app can read permitted context and explicitly act within their authority.

## Model setup

For a hosted NVIDIA endpoint, use the ignored `.env.local` variables in `.env.example`. For the Brev GPU route, follow [BREV-SETUP.md](BREV-SETUP.md). Keep all model keys on the Node server. Brev credits cover running compute; this workflow uses pretrained weights and does not train a model. A provider health check alone does not prove the product performed a live tool-assisted run.

The November 8 browser rehearsal completed a live Brev / vLLM run using `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` and the actual incident, dependency, and impact tools. The GPU uses an 80 GB A100 and a private loopback port forward. Keep the instance, local forward, and local Tether server running for presentation. Toggling a VPN can interrupt the forward without stopping the remote container; reconnect the forward instead of rerunning setup or disabling TLS checks. See [current verification](evidence/TETHER-VERIFICATION.json) for the exact proof.

## Checks and honest limits

```sh
./scripts/dev.sh run typecheck
./scripts/dev.sh run tether:check
./scripts/dev.sh run demo:web:check
./scripts/dev.sh test
```

The historical 60-test response/mesh checkpoint remains in [VERIFICATION.json](evidence/VERIFICATION.json). It is not evidence of live NVIDIA inference or current browser behavior. The encrypted local-peer proof remains a separate three-process protocol test on one Mac; product chat uses authenticated local server streams, not that peer transport.

This build is loopback only and uses plaintext synthetic storage. The company action disables the primary retry route in one disposable process; it leaves the process, control, and safe fallback running. The older CLI separately proves a process stop. It has no deployed SSO, production HR/repository synchronization, production incident management rollout, physical radio mesh proof, or uptime guarantee. Analysis, brief, and import-preview caches are memory only; durable company/auth/authority records persist. Restart creates a new target generation, so earlier actions become stale instead of executing against the replacement. A paid GPU and internet tunnel can fail; the rule-based path must stay visibly distinguishable from successful Nemotron inference.
