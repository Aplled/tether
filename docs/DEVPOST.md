# Tether

## Elevator pitch

Tether maps systems, people, permissions, and incidents, then uses Nemotron to prepare scoped response work that managers review and assign.

## Inspiration

- During an incident, the useful context is often scattered across service maps, repositories, team directories, chat, and access systems.
- A warning can be visible while the right responder still lacks the context or permission to act safely.
- Tether began with a simple human question: what if the company map people already understand could become the place where they coordinate a response?

## What it does

- Provides an editable infinite canvas for systems, people, teams, dependencies, and ownership.
- Keeps three saved workspaces for ordinary operations: **Job requests**, **Model training**, and **Data center operations**.
- Supports node, person, and connection editing, searchable multi-select controls, workspace chat, repository references, incident chat, and response tasks.
- Includes 100 synthetic employee profiles with working hours, availability, notification preferences, and explicit on-call consent.
- Uses four authenticated role views for a senior manager, engineer, data-science manager, and marketing partner.
- Focuses the company graph on two incident rooms: the critical-priority **Customers can restart another customer’s job** and the medium-priority **Training jobs are waiting too long**.
- Gives authorized responders a full incident view while sending marketing a minimal in-app notice that protects private incident details.
- Lets responders join a specific response for one hour, so availability and after-hours consent remain explicit.
- Uses Nemotron through scoped MCP tools to read permitted context, propose per-person work, and prepare separate coding prompts in parallel.
- Lets a manager review and apply the plan once. Tether then persists tasks, prompts, and in-app notices for each recipient.
- Rejects stale plans and prevents duplicate delivery when a reviewed plan is applied again.
- Keeps infrastructure authority separate from model output. A manager can approve an exact allowlisted action against a disposable local service, and the server verifies the result independently.

## How I built it

- TypeScript, Node.js, HTML, CSS, and JavaScript for the desktop-first browser experience.
- Local SQLite for authenticated accounts, company data, workspaces, incidents, conversations, tasks, notices, and audit state.
- Model Context Protocol for bounded read and simulation tools with no shell, raw SQL, or infrastructure control.
- NVIDIA Nemotron 3 Nano served with vLLM on an NVIDIA Brev A100 through a private SSH forward.
- A bounded assignment dispatcher with up to two parallel prompt writers and a maximum of six assignments.
- Server-side checks for current roles, resource grants, repository paths, working hours, availability, consent, and plan revisions.
- A separate trusted authority path for exact-action approval and verified local response.
- Server-Sent Events for authenticated live updates across role sessions.
- A separate encrypted A-to-B-to-C protocol proof across three local processes, with durable queues, signed acknowledgments, replay rejection, and relay restart recovery.

## Challenges I ran into

- Making the model useful without allowing it to grant permission or execute infrastructure changes.
- Sharing enough context for each responder while protecting another person’s private incident and repository scope.
- Preserving user-positioned canvas layouts while focused incident maps highlighted only the relevant systems.
- Binding reviewed plans to changing evidence, permissions, availability, and source mappings.
- Keeping the experience understandable when live model inference is slow or unavailable, with a clearly labeled rule-based fallback.

## Accomplishments I am proud of

- Built a working company graph with 100 employee profiles, 43 connected nodes, three saved workspaces, and four isolated role views.
- Connected a browser-triggered Nemotron workflow to scoped MCP tools and visible provider provenance.
- Delivered reviewed assignments with different recipient-scoped prompts, persisted tasks, and privacy-aware in-app notices.
- Verified that stale plans fail, repeated apply does not duplicate work, and private task details stay role-scoped.
- Verified a disposable local response that blocks an unsafe cross-customer restart while the protected path still accepts the correct customer.
- Passed 94 automated checks and typecheck, then completed browser walkthroughs for setup, workspaces, incidents, assignments, notices, deletion, reload persistence, and recovery.

## What I learned

- Agent workflows need narrow context, current authorization, clear provenance, and deterministic validation around every model result.
- A useful coding prompt needs evidence, permitted repository paths, unknowns, tests, and acceptance criteria for one recipient.
- Canvas state is operational data. Preserving the layout people created matters as much as saving the nodes themselves.
- Recorded checks can explain a response when they are clearly labeled as replay and never presented as live execution.

## What is next

- Connect maintained identity, HR, repository, and incident sources.
- Add managed encrypted persistence and production notification channels.
- Expand the allowlisted response adapters while preserving independent approval and verification.
- Test the resilient peer protocol across separate physical devices and networks.
- Continue refining portrait and mobile layouts after the desktop workflow.

## Built with

- TypeScript
- Node.js
- SQLite
- HTML, CSS, and JavaScript
- Model Context Protocol
- NVIDIA Nemotron 3 Nano
- NVIDIA Brev
- vLLM
- SSH port forwarding
- libsodium
- Server-Sent Events

## NVIDIA track

- Nemotron drives a multi-step agent workflow rather than a single chat response.
- A dispatcher reads incident context through scoped MCP tools and proposes a division of work.
- Parallel prompt writers prepare different prompts using only each recipient’s permitted systems and repository paths.
- The server validates recipients, permissions, availability, consent, source scope, and revisions before a manager can apply the batch.
- Model output remains advisory, while trusted code controls assignment delivery and infrastructure approval.

## NMC² track

- Tether connects data-center warnings to affected systems, owners, dependencies, tasks, messages, and approval state.
- The critical customer restart incident demonstrates scoped investigation and a verified local response.
- The medium training delay incident demonstrates collaboration between engineering and data-science operations.
- Focused maps and plain-language results help a team understand the affected path without exposing raw tool output.

## Links and assets

- Public source repository: <https://github.com/Aplled/tether>
- Devpost thumbnail: `docs/assets/tether-devpost.png`
- Video thumbnail: `docs/assets/tether-video.png`
- Animated hero page: <http://127.0.0.1:4173/hero>
- Local walkthrough: `http://127.0.0.1:4173/`
- Screenshots: `docs/evidence/deletion/two-presentation-incidents.jpg`, `docs/evidence/deletion/active-incident-highlights.jpg`, `docs/evidence/deletion/engineer-popup.jpg`, and `docs/evidence/deletion/marketing-popup.jpg`
- Demo video: add the uploaded video URL after recording the walkthrough in `docs/PRESENTATION.md`

## Project provenance

- The presentation uses synthetic company records and local SQLite.
- Tether uses pretrained Nemotron weights and does not train a model.
- Canvas interactions adapt parts of my existing Graphite project. Tether has its own operational data model, scoped MCP surface, assignment workflow, authority boundary, and response implementation.
- The repository includes preparation and backend work from before the official build window, so I do not claim that every component was created from scratch during the event.
