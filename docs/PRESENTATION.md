# Tether presentation

## Off-clock setup

- Start Tether at `http://127.0.0.1:4173` and keep the Brev instance and private SSH forward available.
- Open four sessions and sign in as Ava Patel, Noah Kim, Priya Raman, and Elena Torres. Read credentials from `.runtime/tether/bootstrap-accounts.json` without copying passwords into presentation material.
- In Noah's session, open **Customers can restart another customer’s job**, select **Tasks**, and choose **Join response for 1 hour**. Repeat for **Training jobs are waiting too long**.
- In Priya's session, complete the same **Join response for 1 hour** action in both incidents.
- In Ava's urgent incident, open **Actions** and complete **Review proposed block** → **Approve and block unsafe restarts** → **Check safe job restarts**. Keep the incident open for the assignment walkthrough; **Verify resolution** closes it and belongs after the presentation. The timed walkthrough presents the saved checks as recorded evidence.
- Return Ava to **System map**. Keep Noah on the urgent incident **Tasks** view, Priya on the urgent incident **Tasks** view, and Elena on her home view.
- Confirm that **Job requests**, **Model training**, and **Data center operations** are visible and that no extra rehearsal tabs remain.

## Two-minute walkthrough

### 0:00–0:20 | Company map

**Click:** Ava → **System map**, then **Job requests**.

**Say:** “Tether gives a company one map of systems, people, permissions, and ownership. This canvas connects 100 employee profiles with 43 nodes. Teams save workspaces with chat and repository references. Two incident rooms cover urgent customer access and medium training delays, with Noah and Priya responding to both.”

### 0:20–0:42 | Focus the urgent incident

**Click:** **Incidents** → **Customers can restart another customer’s job** → **View on map**.

**Say:** “When an incident starts, Tether focuses the map. This critical report concerns cross-customer job restart access. Ava coordinates Noah and Priya, while each person sees only permitted systems and sources. Red nodes show active incident involvement or degraded health.”

### 0:42–1:15 | Nemotron assignment workflow

**Click:** Return to incident → **Tasks** → **Plan assignments** → review cards → **Assign all**.

**Say:** “Nemotron reads permitted incident context through bounded MCP tools. A dispatcher proposes the work, then two prompt writers can prepare recipient-scoped prompts in parallel. The server checks permissions, repository paths, availability, working hours, and explicit on-call consent. Ava reviews the plan once, then Tether saves the tasks, prompts, and in-app notices. Stale plans are rejected, and repeated apply cannot duplicate delivery.”

### 1:15–1:37 | Role-specific results

**Click:** Noah → assignment → **Agent prompt**; then Elena → notice.

**Say:** “Noah receives evidence, allowed paths, unknowns, tests, and acceptance criteria for his assignment. Priya receives a different prompt for her scope. Elena sees only a general request not to interrupt the named responders, with no private incident title or link.”

### 1:37–1:55 | Human-approved response

**Click:** Ava → **Actions** → saved response checks.

**Say:** “These saved checks show a manager-approved, allowlisted local response. Trusted server code blocked the unsafe route, denied the wrong customer, and kept the valid customer path working. This is recorded verification, not live execution.”

### 1:55–2:00 | Close

**Click:** **All incidents**, showing both priorities.

**Say:** “Nemotron prepares work, and people stay in control.”

## One-minute Q&A

### How is NVIDIA used here?

“Nemotron runs a multi-step agent workflow. Scoped MCP reads feed a bounded dispatcher, and parallel writers prepare different prompts for eligible responders. Server checks and manager review control delivery.”

### How does a company get set up?

“An admin can use validated CSV and system-catalog imports, add repository references, and configure people, titles, departments, hours, availability, notification preferences, and resource grants. This presentation uses synthetic snapshots.”

### What stops the AI from changing permissions or infrastructure?

“Graph edits and model output never grant authority. Server policy controls access and assignment rights. Infrastructure actions use a separate allowlisted approval path with an exact target, manager approval, and independent verification.”

## If the model is slow

**Click:** Continue with the visibly labeled rule-based plan → **Assign all** → show Noah’s saved prompt → show Elena’s limited notice.

**Say:** “The live provider is slow, so Tether has clearly labeled the bounded fallback. The same permission, availability, review, persistence, and notice checks still apply. Infrastructure approval remains separate.”
