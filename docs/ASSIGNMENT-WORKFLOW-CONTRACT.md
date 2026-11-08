# Incident assignment workflow

Latest user request, November 8: replace slow manual task preparation with a Nemotron workflow that proposes work, writes individual coding prompts, and delivers approved assignments to each responder. Use the existing bounded MCP/runtime infrastructure. Infrastructure changes still require exact-action approval.

## Owners

- `assignment_runtime`: new `apps/tether/assignments.ts` and its tests. Owns exported types, bounded Nemotron planning/drafting, validation and clearly labeled deterministic fallback. No server/store/UI edits.
- `assignment_integration`: `apps/tether/{server,company,types,handoffs}.ts` and their tests. Owns current authorization/availability, plan/apply HTTP actions, transactional idempotent delivery, persistence and prompt projection. No public UI or assignments-module edits.
- `assignment_interface`: `apps/tether/public/{app.js,panels.js,styles.css}` only. Owns visible progress, editable review, one-click apply, recipient task/prompt access. No canvas rewrites.
- Lead: shared contract, integration, source/security review, actual browser verification and evidence.

All three workers use explicitly GPT-6 Astra under the user's latest agent upgrade. One writer per file.

## Runtime module interface

Export `planIncidentAssignments(input)` from `assignments.ts`. The input contains the incident, semantic revision, manager-visible analysis and nodes, existing tasks, and **server-selected candidates**. Each candidate contains identity/title, eligible node IDs, currently authorized repository paths, and public availability. Integration and runtime owners coordinate exact TypeScript shape directly; freeze it early. Output is a bounded plan with mode/provider/model, summary, tasks, skipped candidates and observed workflow steps. Each task has ownerId, nodeIds, title, manager-facing reason, a recipient-scoped coding prompt, sourcePaths and provenance. Maximum six assignments and two simultaneous prompt-writing calls. Shared deadline and bounded response sizes. Never log secrets.

The planner chooses owner/node allocations. Separate prompt-writing calls receive only each recipient's permitted context, never the manager's full graph or another person's private context. Validate all IDs and paths against supplied candidates. Model output creates no grants, accounts, source permissions, approvals, deployments or shell execution. Missing model access or invalid output produces an honest labeled fallback. External coding-agent execution is not configured; prepared work is delivered inside the recipient's account, with a working copy/export path.

## Actions

- `assignment.plan {incidentId}`: current incident assignment authority required. Read fresh incident/graph/tasks and roster, filter to active incident members with relevant node/source access and current eligible hours/on-call consent. Generate one plan for review; no tasks or notifications yet. Return `{planId,incidentId,mode,provider,model,summary,tasks,skipped,steps,generatedAt}`. Bind plan to actor, incident, graph/evidence/policy/roster/source/task versions; expire it. Reauthenticate after inference.
- `assignment.apply {planId}`: recheck current assignment authority and every proposed recipient, node, repository, availability and snapshot before any write. Apply the entire accepted plan once in a company transaction, persist prompts alongside tasks, send per-recipient assignment notices. Return task IDs. Repeating the same plan must return the same tasks, with no duplicate notices.
- Optional `assignment.volunteer {incidentId}`: a current incident member may explicitly accept one hour of on-call availability for this incident workflow. No change to authority and no blanket after-hours notification opt-in. The interface can instead use the existing self-settings flow if faster.

Prompt reads remain limited to assignee or authorized manager, with current repository/source grants and stale-evidence checks. Do not include private prompt bodies in other responders' or marketing state/events. Applying a plan does not execute the prompts or mark investigation complete. Preserve existing manual task editing and all response/containment and mesh behavior.

## UI and verification

Tasks should offer **Plan assignments**, display visible working stages and per-person cards, show skipped/off-hours people clearly, and let the manager **Assign all** after reviewing. Recipients see saved assignments and prepared prompts without generating each one manually. Keep fallback provenance visible; plain names, no raw JSON. Show partial model fallback honestly.

Required checks: invalid/out-of-scope model output, stale/revoked access, off-hours exclusion and explicit opt-in, entire-batch preflight, duplicate apply, prompt persistence, private projection, honest fallback, model-request validation. Then a fresh browser reviewer completes manager plan/apply and recipient prompt access with actual live inference when available. Test totals alone are insufficient.
