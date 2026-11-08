# Tether presentation script

## Before the demo

- Start Tether and open `http://127.0.0.1:4173` in four tabs.
- Sign in as Ava Patel, Noah Kim, Priya Raman and Elena Torres. Get credentials only from `.runtime/tether/bootstrap-accounts.json`; never put passwords in slides, notes or chat.
- Keep Ava's tab first, Noah second, Priya third and Elena fourth.
- Close extra rehearsal tabs. Keep the Brev instance, private SSH forward and local Tether server running.
- Confirm the three main workspaces are **Job requests**, **Model training** and **Data center operations**.
- Confirm the two incidents are **Customers can restart another customer’s job** at critical priority and **Training jobs are waiting too long** at medium priority. Ava is commander; Noah and Priya are shared incident members; Elena receives only the minimal notice.
- Both incidents intentionally start with zero analysis runs and zero tasks so the assignment workflow can be shown live.
- Before Ava plans assignments, complete four incident-specific opt-ins: in Noah's tab open each incident → **Tasks** → **Join response for 1 hour**; repeat in Priya's tab. Each consent applies to one person and one incident only.

## Three-minute exact walkthrough

These times are targets. Talk while the model runs, skip optional details, and allow extra time for the live provider. The short backup below is for a faster explanation, not a guarantee that an unavailable provider will time out within thirty seconds.

### 0:00–0:18 — Problem and company map

**Click:** Ava tab → **System map**.

**Say:** “Tether gives a company one shared map of its systems and the people responsible for them. Teams use the same map for normal work, then focus it when something goes wrong. This build has 100 synthetic employee profiles, 43 map nodes, four real isolated logins and a local authenticated backend.”

**Point out:** Nodes turn red only when they belong to an active incident or their current health is failing. A **Critical system** badge means business importance; it does not mean the system is currently broken. Incident priority is also separate: it tells the team how urgently to respond.

### 0:18–0:35 — Ordinary work is separate

**Click:** **Job requests** in the workspace list. It opens its saved map directly.

**Say:** “This is a real saved workspace, separate from an incident. Teams can organize systems and collaborators, attach repository references and keep a conversation here without creating an emergency.”

### 0:35–0:58 — Open the urgent issue

**Click:** **Incidents** → open **Customers can restart another customer’s job** → **Overview** → **View on map**.

**Say:** “This urgent report says one customer may be able to restart another customer's compute job. Ava coordinates the response. Noah is the engineer, and Priya is the data-science manager. The focused map shows only the affected path. The report is a concern that needs verification, not a confirmed cause.”

**Point out:** Job API, tenant authorization, retry route and training catalog. Job API intentionally has no mapped source path, so the assignment plan should disclose that coverage gap instead of inventing one.

**Click:** the incident tab to return from the focused map to the incident page.

### 0:58–1:18 — Scoped Nemotron analysis

**Click:** **Overview** → **Analyze affected path**. Open **Findings and next steps** only if the main summary needs support.

**Say:** “Nemotron reads only permitted incident context through bounded MCP tools. It can explain the affected path and suggest checks, but it cannot grant access, approve an action or run shell commands. The provider label tells us whether this is live Nemotron or the clearly labeled rule-based backup.”

**If useful, click:** **Replay completed checks**.

**Say:** “This is playback of recorded checks for explanation. It is not live execution and does not claim the service has been repaired.”

### 1:18–1:52 — Plan and deliver assignments

**Click:** **Tasks** → **Plan assignments**. Wait for the plan cards. Review Noah's and Priya's cards → **Assign all**.

**Say:** “A bounded dispatcher proposes who should do what. Up to two prompt writers work in parallel, but each sees only that recipient's allowed systems and repository paths. Current availability, working hours and explicit on-call consent are checked by the server. Ava reviews one plan and applies it once. Tether then saves the tasks, recipient-scoped coding prompts and in-app notices. It does not launch an external coding agent.”

**Click:** Noah tab → open the incident → **Tasks** → Noah's assignment → **Agent prompt**.

**Say:** “Noah gets evidence, permitted paths, unknowns, tests and acceptance criteria for his part only.”

**Click:** Priya tab → open the same incident → **Tasks** → Priya's assignment.

**Say:** “Priya gets a different prompt for the training and data scope. A stale plan is rejected if evidence, permissions, availability or source mappings change. Reapplying the same plan does not duplicate tasks or notices.”

### 1:52–2:25 — Human approval and verified response

**Click:** Ava tab → the incident tab → **Actions** → **Review proposed block** → **Approve and block unsafe restarts** → **Check safe job restarts** → **Verify resolution**. Expand **Technical action details** only if a judge asks for the digest.

**Say:** “The model stops at a proposal. Ava reviews the exact operation, target generation and digest. The trusted server enforces approval and independently checks the result. Here the unsafe restart route is blocked, the wrong customer is denied, and a valid request still works. I verified the protected path; I am not claiming the source code was repaired or anything was deployed to production.”

### 2:25–2:38 — Show the medium issue

**Click:** **All incidents** → **Training jobs are waiting too long** → **Overview**.

**Say:** “The second issue is a medium-priority training backlog. Noah and Priya split the systems between application investigation and training operations. Priority tells us response urgency. A Critical system badge tells us business importance; neither label changes permissions.”

**Point out:** Training catalog, training dispatch, queue priority, scheduler and capacity reporting. The catalog mapping is metadata-only, not a complete training runtime.

### 2:38–2:53 — Minimal marketing notice

**Click:** Elena tab and point to the notice banner. A new incident created while Elena is signed in also produces a **Team notice** popup. The two prepared incidents already exist, so opening a fresh Elena session shows their saved notices in the banner without replaying old popups. There is no Notifications page.

**Say:** “Elena receives only the approved general message: avoid interrupting Noah and Priya while they respond. Her popup names the responders but does not expose the private incident title or offer an Open incident button.”

The popup is browser-verified. A new assignment gives Noah a **New assignment** popup with the incident title and an **Open incident** button; Elena receives a generic **Team notice** without private incident access. Dismissal marks the notice read, so reload does not replay it.

### 2:53–3:00 — Close

**Say:** “Tether turns a company map into a permission-aware response room: Nemotron prepares the work, people review it, and trusted code controls the action.”

## Thirty-second backup walkthrough

Use this if live Nemotron or the tunnel is unavailable.

**Click:** Ava → urgent incident → **Overview** → **Tasks** → **Plan assignments** → review the visibly labeled rule-based plan → **Assign all** → Noah tab → **Tasks** → **Agent prompt** → Elena tab → show the limited notice banner.

**Say:** “Tether focuses the company graph on an urgent cross-customer restart report. Nemotron normally reads scoped context and prepares separate work for Noah and Priya. The provider is unavailable right now, so Tether clearly labels and applies the bounded rule-based backup instead of pretending it was live. Noah receives a saved scoped prompt, while Elena sees only a minimal do-not-interrupt notice. The infrastructure action remains a separate human approval.”

## Judge Q&A

### Is onboarding connected to live HR and repository systems?

“No. Setup supports server-validated CSV employee imports, bounded system-catalog imports and admin-configured repository references. These are snapshots, not maintained connectors, and they do not import credentials.”

### Is this using Supabase or production authentication?

“The presentation uses real local accounts and per-tab sessions backed by local SQLite. A dedicated Tether Supabase project is available but unused. I do not claim a deployed Supabase integration, SSO or production hosting.”

### Can moving a node or connecting systems change permissions?

“No. The graph explains relationships, while server policy controls access. Dragging a node, adding an edge, joining a workspace or receiving a message does not grant source access, assignment authority or infrastructure approval.”

### What does the AI actually do?

“Nemotron reads scoped context through MCP, explains the incident, proposes assignments and prepares recipient-specific coding prompts. The server validates every recipient, path, permission and revision. A human manager applies the batch. External coding applications are still a manual next step.”

### Can the AI execute the response?

“No. It can propose an allowlisted response. The authorized commander reviews the exact action and digest. A separate trusted authority enforces approval, executes only the supported local action and independently verifies the effect.”

### Did you repair the service?

“No. The demonstration blocks one unsafe route in a disposable local service and checks a prebuilt protected path. It verifies the immediate response, not a source-code repair or production deployment.”

### How is assignment safety handled?

“Plans are bound to current incident, graph, evidence, policy, roster, source and task revisions. A change makes the plan stale. Applying a reviewed plan is transactional and idempotent, so it does not partly deliver or create duplicates.”

### What if someone is off hours?

“Tether respects working hours, leave, notification preferences and explicit on-call consent. A responder can volunteer for one incident for one hour. The system never promotes someone or overrides an opt-out just because a manager is unavailable. If nobody eligible can approve, responders can triage read-only while risky actions remain blocked.”

### Are notifications sent by phone or email?

“No. Current notifications are saved inside Tether and newly delivered notices can appear as in-app popups. Noah's assignment popup opens the permitted incident. Elena's generic team popup does not expose the private title or link her into the incident. There is no OS push, email, SMS, background pager or automatic escalation daemon.”

### Is the mesh running between three devices?

“No. The retained proof uses three real peer processes on one Mac. It demonstrates encrypted A-to-B-to-C relay, durable custody, a signed final receipt, replay rejection and relay restart recovery. It is not physical radio-mesh evidence.”

### Does product chat use that mesh?

“No. Product chat uses authenticated local Server-Sent Events. The three-peer protocol is a separate resilience proof.”

### Why NVIDIA?

“Nemotron is part of a multi-step tool workflow, not a chat wrapper. It uses scoped MCP reads, a bounded dispatcher and parallel recipient prompt writers. The model never receives infrastructure authority.”

### Why NMC²?

“Tether helps data-center teams act on warnings and handoff failures by bringing the affected systems, owners, tasks, messages and approval state into one shared operational view.”

### What is verified today?

“The current company suite passes 94 checks and typecheck. Browser walkthroughs also confirmed workspace and incident deletion across tabs, draft preservation during notifications, and reload persistence. A separate before-and-after check confirmed all 43 saved node positions and layout revisions were unchanged across restart and cleanup. Tests alone do not prove the interaction works.”

## Claims to avoid

- Do not say the app is production-ready, cloud-deployed or using deployed Supabase.
- Do not say the model was trained; it uses pretrained Nemotron weights.
- Do not say replay is live execution.
- Do not say the service source was repaired.
- Do not say external coding agents run automatically.
- Do not say imports are maintained connectors.
- Do not say notifications include OS push, email or SMS.
- Do not say the three-peer proof used three physical devices or that product chat uses it.
