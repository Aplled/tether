# Tether walkthrough

Tether uses synthetic Northstar Compute records and isolated local infrastructure. The normal product surface omits rehearsal labels, while this document preserves the provenance and limits.

## Start and sign in

```sh
./scripts/dev.sh run tether:web
```

Open <http://127.0.0.1:4173>. The runtime uses the project's private Node 26.13.0, loopback HTTP, local SQLite, and authenticated per-user event streams. The dedicated Tether Supabase project is connected but unused; no cloud migration is required for this one-Mac presentation. Runtime data persists in `.runtime/tether`; never commit or distribute that directory.

Generated setup credentials are in `.runtime/tether/bootstrap-accounts.json`, mode 0600. The four emails are `ava@northstar.local`, `noah@northstar.local`, `priya@northstar.local`, and `elena@northstar.local`. Open each in a separate tab. Each tab stores its own bearer token in sessionStorage, so signing out in one does not replace the others' identities. This is convenience isolation for the presentation, not protection against same-origin malicious JavaScript.

Live streams renew every ten seconds and recheck the current account on reconnect. This prevents old tabs from occupying all browser connections indefinitely. With many same-origin tabs, a request can still wait for a stream to renew. [MDN documents this HTTP/1 connection limit](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events). Close stale rehearsal tabs before presenting; the four role tabs are the intended walkthrough.

## Setup through response

1. As Ava, start in a named ordinary workspace. Show the company map and directory, add an employee and a system, assign an owner, and create/edit/delete a connection through its menu. Create a normal workspace with selected systems and collaborators, switch to it, and send a workspace message. Reload to confirm persistence. Inspect CSV/catalog imports through server validation and explicit commit. Import is a snapshot; it does not create a maintained live connector or grant credentials.
2. Open the four views. Noah sees relevant software systems; Priya sees her training/data scope. Elena receives ordinary permitted context and no private security workspace.
3. Report the observation: a customer could restart another customer's compute job. Select GPU Job API, Customer Access Checks, and Job Retry Endpoint, then choose **Create incident**. Set Critical priority and add Noah and Priya under Ava's coordination. The explicit system-sharing checkbox gives selected responders read access to these systems, without granting source, write, or approval access. Workspace membership alone never shares incident information.
4. Start analysis explicitly. The big summary describes the reported problem and separates it from a confirmed cause. Inspect the actual provider label and recorded checks. **Rule-based plan** means the backup, not live Nemotron. **Replay completed checks** reviews actual recorded steps and map scope; it does not animate new execution. **View on map** shows exactly the incident's systems at a readable scale; **Show all systems** restores the company view.
5. Assign scoped tasks, exchange messages, acknowledge work, and review each engineer's coding-agent prompt before copying. If browser clipboard access cannot be verified, **Select prompt text** selects the complete readonly prompt for keyboard copying. A prompt can become stale after evidence, source, assignment, or permission changes. Copying it does not grant the external agent repository or infrastructure access.
6. Open Actions and review **Block unsafe job restarts**. Only the current authorized commander can approve. The exact operation, target generation, and digest remain available under technical details. Layout dragging does not invalidate an action; changed dependencies, evidence, grants, or target do.
7. Run the safe-restart checks and verify resolution. The main result cards show the unsafe route blocked, the wrong customer denied, valid requests still working, and resolution verified. The map marks **Unsafe restart blocked**, independently from service availability. The code is not declared repaired. This checks a prebuilt protected path; it does not deploy another service or change production routing. A network error or model assertion is not verification. An unrelated incident shows coordination tools without offering this specific automatic response.
8. In Elena's view, show the approved general notice and responder names without the exploit, private conversation, repository paths, task content, or hidden incident identifier.

After-hours preferences default off; the synthetic Ava account starts with an explicitly configured accepted on-call window. A manager's title does not require overnight work. The coverage check explains current authorized candidates and why others are ineligible, without promoting anyone. It is a manual, point-in-time eligibility check: there is no background pager, acknowledgment timeout, retry loop, or outbound email/SMS/push delivery. Saved notifications appear only inside the app. A user who voluntarily opens the app can read permitted context and explicitly act within their authority.

Imports show the records to add and the existing records to update before confirmation. Reusing a stable ID updates that record. Invalid files keep confirmation disabled; choosing a different file requires another preview. The server checks references again before applying the file. Covered validation errors fail before any rows are written, but the batch is not one crash-atomic database transaction.

## Model setup

For a hosted NVIDIA endpoint, use the ignored `.env.local` variables in `.env.example`. For the Brev GPU route, follow [BREV-SETUP.md](BREV-SETUP.md). Keep all model keys on the Node server. Brev credits cover running compute; this workflow uses pretrained weights and does not train a model. A provider health check alone does not prove the product performed a live tool-assisted run.

The November 8 browser rehearsals completed live Brev / vLLM runs using `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` and actual scoped tools. The GPU uses an 80 GB A100 and a private loopback port forward. Keep the instance, local forward, and local Tether server running for presentation. `./scripts/brev-forward.sh` maintains the existing private forward and retries after a network interruption; run only one forward on local port 8000. Toggling a VPN can interrupt the forward without stopping the remote container. Reconnect instead of rerunning model setup or disabling TLS checks. The initial live-provider proof is retained in [TETHER-VERIFICATION.json](evidence/TETHER-VERIFICATION.json).

## Checks and honest limits

```sh
./scripts/dev.sh run typecheck
./scripts/dev.sh run tether:check
./scripts/dev.sh run demo:web:check
./scripts/dev.sh test
```

The historical 60-test response/mesh checkpoint remains in [VERIFICATION.json](evidence/VERIFICATION.json). It is not evidence of live NVIDIA inference or current browser behavior. The encrypted local-peer proof remains a separate three-process protocol test on one Mac; product chat uses authenticated local server streams, not that peer transport.

The [browser record](evidence/REBUILD-VERIFICATION.json) preserves four broad walkthroughs and further setup/import reviews, current screenshots, actual copy/paste and collaboration checks, session fixes, response results, and eight-tab stress behavior. Its limitations distinguish reviewed flows from untested product breadth.

This build is loopback only and uses plaintext synthetic storage. The company action disables the primary retry route in one disposable process; it leaves the process, control, and safe fallback running. The older CLI separately proves a process stop. It has no deployed SSO, production HR/repository synchronization, production incident management rollout, physical radio mesh proof, or uptime guarantee. Analysis, brief, and import-preview caches are memory only; durable company/auth/authority records persist. Restart creates a new target generation, so earlier actions become stale instead of executing against the replacement. A paid GPU and internet tunnel can fail; the rule-based path must stay visibly distinguishable from successful Nemotron inference.
