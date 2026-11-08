# Tether — Devpost copy

## Title

Tether

## Elevator pitch (under 200 characters)

Tether maps systems, owners and incidents, then uses Nemotron and scoped MCP tools to prepare safe response work that a human manager reviews, assigns and approves.

## Inspiration

Operational incidents become harder when system context, ownership, permissions, messages and response work live in separate tools. A warning may be visible, yet the right responder still lacks the context to act safely. I built Tether to give a company one shared, permission-aware map for ordinary work and incident response.

## What it does

Tether gives teams an editable canvas of systems, people, teams and their connections. Teams can save normal workspaces, attach repository references, import bounded employee or system catalogs, and collaborate without turning every workspace into an incident.

When an issue occurs, a manager selects the affected systems and responders. Tether shows the relevant map, keeps private details scoped to authorized people, and lets responders talk and work in the same incident. Nemotron reads permitted context through MCP, proposes a division of work, and prepares a separate coding-agent prompt for each eligible responder. The manager reviews the batch and applies it once; tasks, prompts and in-app notices are persisted without automatically starting any external coding application.

For the response demonstration, Tether prepares an exact allowlisted action for a disposable local service. Only an authorized manager can approve it. The server independently verifies the result and checks that the protected path still accepts a valid request while denying the wrong customer. Model output never grants permission or executes infrastructure changes.

## How I built it

- A desktop-first browser app at `127.0.0.1:4173`, backed by TypeScript and local SQLite.
- Four authenticated, isolated accounts for a commander, engineer, data-science manager and marketing partner.
- A shared operational graph with node, person and connection editing, saved workspaces, repository references, incident rooms, tasks and messages.
- A real MCP client/server bridge exposing bounded read and simulation tools instead of shell, SQL or infrastructure access.
- NVIDIA Nemotron 3 Nano served on an NVIDIA Brev A100 through a private SSH forward. Tether uses pretrained weights; it does not train a model.
- A bounded assignment dispatcher plus at most two parallel recipient-prompt writers. Every output is checked against current permissions, source paths, availability and explicit after-hours consent.
- Stale-plan rejection and idempotent apply protection so changed context cannot silently deliver an old plan and repeated apply does not duplicate work.
- A separate trusted authority path for exact-action approval and independent verification.
- A retained protocol proof for encrypted A-to-B-to-C delivery across three local peer processes on one Mac, with durable queues, signed acknowledgments, replay rejection and relay restart recovery. Product chat itself uses authenticated server event streams.

## Challenges I ran into

- Keeping AI useful while preventing it from gaining authority. I separated model planning from permission checks, exact-action approval and execution.
- Giving each responder enough context without leaking another person's private incident or repository scope.
- Making long model work understandable in the interface while preserving a clearly labeled rule-based fallback when the provider is unavailable.
- Keeping a reviewed assignment safe when evidence, permissions, availability or source mappings change. Plans are bound to current revisions and rejected when stale.
- Demonstrating resilience honestly with one available computer. My mesh evidence uses three real local processes, not three physical devices or a radio network.

## Accomplishments I am proud of

- Built a working company map with 100 synthetic employee profiles, 43 connected map nodes, real local authentication and four isolated role views.
- Connected a browser-triggered Nemotron run to real scoped MCP tools and displayed its provider provenance.
- Built one-review assignment delivery with per-recipient prompts, access and availability checks, explicit on-call consent, stale-plan rejection and duplicate-apply protection.
- Preserved a strict boundary between AI recommendations and human-approved infrastructure actions.
- Verified a disposable response path that blocks an unsafe cross-customer restart while the protected path still accepts the correct customer.
- Passed the current 94-check company suite and typecheck. Browser walkthrough evidence is maintained separately because API and unit checks alone do not prove the interface works.

## What I learned

Agent workflows need smaller scopes, stronger validation and clearer provenance than a normal chat response. A good result is not only a plausible plan: it must be tied to current evidence, permitted sources, an available person and a reviewable action. I also learned that replaying recorded checks can be useful for explanation, but it must be labeled as replay and never presented as new execution.

## What is next

- Replace local accounts and plaintext synthetic SQLite storage with production identity, encryption and managed persistence.
- Add maintained HR, repository and incident-system connectors; current imports are validated snapshots.
- Add production-grade notification delivery and acknowledgment timing. Current notices are in-app only.
- Expand the allowlisted response adapters while preserving independent approval and verification.
- Test the resilient peer protocol on separate physical devices and networks; the current proof is three processes on one Mac.
- Improve mobile layouts after the desktop presentation path is complete.

## Built with

TypeScript, Node.js, SQLite, HTML, CSS, JavaScript, Model Context Protocol (MCP), NVIDIA Nemotron 3 Nano, NVIDIA Brev, vLLM, SSH port forwarding, libsodium, Server-Sent Events.

## Submission links and assets

- Source repository: <https://github.com/Aplled/tether>. It is private; do not describe it as publicly accessible or change visibility without permission.
- Live walkthrough: <http://127.0.0.1:4173/> runs only on this Mac. It is not a public hosted demo link.
- Video: record the walkthrough in `docs/PRESENTATION.md`, then add the real uploaded video URL. No video URL has been created.
- Screenshots: `docs/evidence/deletion/two-presentation-incidents.jpg`, `active-incident-highlights.jpg`, `engineer-popup.jpg`, and `marketing-popup.jpg`.
- Tracks: NVIDIA and NMC². Their relevant fit is described below; entry is not a claim of sponsor approval or eligibility confirmation.
- Reused work: canvas interactions adapt parts of Graphite, and this repository contains earlier preparation/backend work. Disclose that provenance wherever the submission asks about prior work. Do not claim every component was written from scratch during the official build period.

## NVIDIA track fit

Tether uses Nemotron beyond a chatbot. A dispatcher reads incident context through scoped MCP tools, proposes assignments, and parallel prompt writers prepare different, permission-limited work for each recipient. The outputs remain untrusted: the server validates recipients, source paths, availability and revisions, and a human manager applies the reviewed batch. A separate authority service controls any infrastructure action.

## NMC² track fit

Tether helps data-center teams respond to warnings and handoff failures with a shared map of affected systems, owners and dependencies. The demonstration covers two operational stories: the critical-priority **Customers can restart another customer’s job** and the medium-priority **Training jobs are waiting too long**. Tether brings the right responders and scoped context together, prepares the handoff, and keeps approval and verification visible.

## Honest demo limits

Tether is a local presentation build using synthetic records. It is not production-hosted and has no deployed Supabase integration, SSO, maintained HR/repository connectors, OS push, email or SMS. In-app saved notices and role-scoped popups are implemented and browser-verified: responders can open permitted incidents, while a marketing notice reveals no private incident title or link. External coding agents are not started automatically. The response affects one disposable local route and does not claim the source code is repaired. Live model availability depends on the Brev instance and private tunnel; any fallback is labeled. The mesh proof uses three local peer processes on one Mac and is separate from product chat.
