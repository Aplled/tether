# Product Requirements Document — Name TBD
## The Local-First, Agentic Cyber-Resilience Platform
### Product Requirements Document | HackUTD 2026

**Version:** 3.2 — accepted demo direction\
**Status:** Backend demo implemented and verified November 7, 2026; UI and production infrastructure remain out of scope\
**Potential foundation:** Graphite at `/Users/vyomsingh/Projects/flowstate` audited; standalone incident core with selective helper reuse recommended\
**Primary audience:** Everyday people, small businesses, nonprofits, and community organizations\
**Secondary audience:** Small technical teams, local institutions, volunteer response teams, and organizations without dedicated cybersecurity departments\
**Development strategy:** Standalone application first, Graphite-derived implementation or fork when advantageous\
**Target:** HackUTD 2026\
**Product name:** TBD; this is a placeholder, not a chosen brand\
**Hackathon theme:** Zero Day\
**Planning date:** November 6, 2026

**User-provided build window:** Saturday November 7, 10:00 → Sunday November 8, 10:00, Dallas time (`America/Chicago`, CST). This is 11:00 → 11:00 in New Jersey (`America/New_York`, EST).\
**Available test hardware:** This Mac confirmed; iPhone running iOS 27.0.1 possible; user explicitly confirms no third physical device.

---

## Confirmed priorities and accepted demo scope

This document preserves the full supplied product vision, with the name corrected to **TBD**. Zero Day is the hackathon theme. The user confirmed that both the response loop and mesh protocol are mandatory and explicitly accepted the three-local-peer demo on November 7, 2026. The scope below supersedes the original physical three-device demo criterion. The broader feature vision remains roadmap context; detailed implementation choices can be resolved within this accepted scope.

- **Product thesis:** Preserve an essential operation during a cyber disruption through explainable impact analysis, tightly controlled containment, resilient coordination, and verified fallback.
- **Reference scenario:** A fictional food pantry loses trust in its scheduling integration. Contain only a disposable demonstration service, preserve volunteer check-in through an approved offline roster, and verify continued distribution.
- **Recommended first vertical slice:** Incident evidence → deterministic dependency evaluation → structured agent proposal → exact-action human approval → real sandbox action → independent verification → fallback tasks → verified operation on fallback.
- **Cybersecurity proof:** Demonstrate both an allowed action and rejected attacks: unauthorized execution, changed approval targets, stale approvals, duplicate execution, untrusted model instructions, and cross-scope reads.
- **Communications — mandatory and accepted:** Develop messaging/relay in parallel with the response loop. Demonstrate encrypted A→B→C forwarding across three real local peers on this Mac, persistent queues, signed recipient acknowledgments, replay rejection, and relay restart recovery. A separate native Mac↔iPhone link is optional if setup works. Physical three-device/radio mesh remains unverified and must be described that way.
- **Authority:** One trusted local coordinator for the MVP. Other offline devices can exchange coordination messages and queue proposals. They cannot independently approve or execute infrastructure changes. Cloud hosting is optional for this slice.
- **Agent role:** AI reads scoped context and proposes structured plans. Deterministic application services own impact calculations, permissions, state transitions, and execution.
- **Scope reductions:** One seeded organization, one incident type, one containment adapter, one fallback, one demonstrated MCP client. Production integrations, automatic containment, universal mesh, full distributed consensus, and a five-agent autonomous council remain roadmap items.
- **UI:** Interface sections below are retained from the source vision for later work. UI design and polish are outside the current planning and implementation priority.
- **Security standard:** Build an explicit threat model and testable controls; do not claim the prototype is fully secure, uncompromised, or production certified.
- **Development staffing:** The lead coordinated bounded GPT-5.6 Sol implementation workers for domain/persistence, security/containment, and communications/MCP integration. Each worker reported files, tests, risks, and integration evidence.
- **Implemented checkpoint:** Both mandatory demo pillars now run together. The deterministic graph, scoped MCP proposal path, exact proposal-to-policy binding, exact-action policy, broker-owned disposable process, independent observation, verified fallback tasks and graph availability, durable SQLite state, bounded injected-planner run coordinator, and encrypted three-local-peer relay have passing tests and a repeatable integrated demo. A deployed LLM provider is not implemented or claimed. Native iPhone tooling/signing remains optional and unverified. See [DATA-CONTRACTS.md](docs/DATA-CONTRACTS.md) for the actual shared API and evidence constraints.

Detailed architecture and implementation records:

- [Backend and domain architecture](docs/ARCHITECTURE.md)
- [Development and product-agent orchestration](docs/AGENT-ORCHESTRATION.md)
- [Researched security requirements and proof criteria](docs/SECURITY-PLAN.md)
- [24-hour build and airport preparation plan](docs/BUILD-PLAN.md)
- [Flowstate reuse audit](docs/FLOWSTATE-AUDIT.md)
- [Device and mesh feasibility](docs/MESH-FEASIBILITY.md)

**Provenance:** Converted from the user's pasted version 3.0 brief and updated with their November 6 hardware, schedule, repository, mandatory-mesh clarification, and November 7 backend implementation. Original feature breadth is retained below as roadmap context; the implemented checkpoint is described above and in the linked architecture/data-contract documents.

---

# 1. Executive Vision

## 1.1 Product statement

TBD is a local-first cyber-resilience platform that helps people and organizations understand, contain, communicate through, and recover from major digital disruptions.

It combines an interactive organizational dependency graph, operational impact simulation, intelligent graph pruning, distributed emergency communication, policy-controlled infrastructure isolation, and AI agents connected through MCP.

When a critical service is compromised or unavailable, TBD answers four questions:

1. What is affected?
2. What should we protect or isolate?
3. How can we continue communicating and operating?
4. Who needs to do what, and how do we verify completion?

TBD should not merely visualize failures. It should translate them into coordinated and verifiable operational responses.

## 1.2 Human-centered mission

Large organizations often have dedicated security teams, sophisticated monitoring, and established recovery systems.

Ordinary people and smaller organizations often lack these resources.

A disrupted scheduling system may stop a food pantry from distributing supplies. A compromised communications provider may prevent a small clinic from coordinating staff. A service failure may leave a family-owned business unable to process essential transactions.

TBD seeks to reduce this disparity by making resilience tools understandable and accessible to nontechnical users.

The product must never require users to understand cryptographic keys, dependency algorithms, infrastructure topology, or cybersecurity terminology to perform ordinary emergency tasks.

## 1.3 Core value proposition

**Know what breaks. Protect what matters. Stay connected. Keep operating.**

The central innovation is an executable operational graph.

Rather than treating the graph as a static visualization, TBD uses relationships between people, services, tasks, and workflows to drive impact calculations, containment planning, communications, task assignment, and recovery verification.

## 1.4 What TBD does not claim

TBD does not discover unknown vulnerabilities, guarantee zero-day protection, determine whether a system is truly secure, or replace qualified incident responders.

It focuses on coordinating the response to suspected compromise, verified disruption, and infrastructure failure.

A zero-day exploit is a motivating scenario, but the product should also support ransomware incidents, vendor outages, compromised accounts, communications failures, and other emergencies.

---

# 2. Target Audience and Use Cases

## 2.1 Primary users

### Everyday individuals

People who depend on digital services but have limited technical expertise.

Relevant use cases include local emergency communication, trusted contact coordination, access to preprepared recovery information, and understandable instructions during outages.

The individual experience should not require constructing an organizational graph.

### Small businesses

Organizations that depend on point-of-sale systems, cloud storage, scheduling tools, communications platforms, and financial services but lack full-time security teams.

Relevant use cases include dependency mapping, outage response, employee coordination, manual fallback operations, and controlled service isolation.

### Nonprofits and community organizations

Organizations coordinating volunteers, donations, services, and time-sensitive assistance.

These represent the strongest initial demonstration audience because essential workflows can be clearly modeled and their disruption has visible human consequences.

## 2.2 Secondary users

- Organization managers and operational coordinators.
- Technical advisors and cybersecurity responders.
- Volunteers and employees.
- Local emergency coordinators.
- MCP-connected AI agents.

## 2.3 Reference hackathon scenario

A community food pantry depends on a cloud-based volunteer scheduling service, donation system, inventory platform, and messaging provider.

A suspected cyber incident disrupts the scheduling platform and threatens access to operational information.

TBD models the affected workflows, identifies critical dependencies, evaluates alternative operating procedures, and coordinates the transition to a verified backup.

If the organization's primary communication service becomes unavailable, nearby devices continue exchanging incident messages through a local peer-to-peer network.

The demo should show the system preserving a real operational workflow, not simply changing node colors.

---

# 3. Product Architecture

TBD consists of six interconnected systems.

### System A: Operational Intelligence Graph

Models people, services, resources, tasks, workflows, dependencies, and incident state.

### System B: Incident and Containment Engine

Evaluates disruptions, simulates operational consequences, and coordinates approved infrastructure-control actions.

### System C: Adaptive Graph Pruning

Reorganizes the workspace during emergencies to emphasize critical information while preserving the complete underlying graph.

### System D: Resilient Communication Mesh

Supports ordinary synchronized communication and locally relayed messaging when connectivity is degraded.

### System E: Human Operations and Authority

Connects managers, employees, volunteers, and responders through responsibilities, approvals, tasks, and recovery workflows.

### System F: MCP Agent Interface

Allows authorized AI agents to observe incidents, analyze graph data, propose actions, and execute explicitly permitted operations through the same application services used by people.

These systems must operate against a shared data model.

Do not construct six disconnected applications behind one interface.

---

# 4. Operational Intelligence Graph

## 4.1 Purpose

Graphite's graph architecture is a possible foundation for the operational model, subject to repository inspection and a bounded reuse assessment.

The graph represents how an organization actually functions.

It must answer not only which services are connected, but what happens when one of them becomes unavailable.

## 4.2 Node types

The system should support:

- Person
- AI Agent
- Team
- Organization
- Digital Service
- Infrastructure Component
- Business Operation
- Task
- Project
- Resource
- Document
- Communication Channel
- Incident
- Vulnerability or Threat Observation
- Fallback Procedure
- Approval
- Response Plan

Every node should have a stable identifier, type, organization scope, metadata, criticality, state, and relevant ownership information.

## 4.3 Relationship types

Examples:

- DEPENDS_ON
- REQUIRED_BY
- ALTERNATIVE_TO
- OWNED_BY
- ASSIGNED_TO
- APPROVED_BY
- MANAGED_BY
- COMMUNICATES_WITH
- HOSTED_ON
- IMPACTED_BY
- BLOCKED_BY
- RESPONDS_TO
- EXECUTES
- VERIFIED_BY

Relationships must carry explicit semantics.

For example, a service being owned by an employee does not mean the employee automatically becomes unavailable when the service fails.

## 4.4 Dependency logic

Support:

**Hard dependencies:** The workflow cannot operate without the resource.

**Optional dependencies:** The resource improves functionality but is not essential.

**Alternative dependencies:** Another service or procedure can fulfill the same requirement.

**Grouped dependencies:** Some operations require multiple simultaneous resources, while others can function if at least one alternative remains available.

**Conditional dependencies:** Certain requirements apply only under specified circumstances.

**Unknown dependencies:** Missing information must not be treated as evidence that a system is independent or safe.

## 4.5 Impact propagation

When a node becomes unavailable, the engine evaluates downstream dependencies.

Operational states include:

- Operational
- At risk
- Degraded
- Blocked
- Running on fallback
- Unknown

Each calculated state must include an explanation of the dependency path and relevant assumptions.

Observed system status and modeled operational consequences must be stored separately.

## 4.6 Graph algorithm requirements

Evaluate deterministic algorithms for:

- Directed graph traversal.
- Dependency propagation.
- Reachability.
- Critical path identification.
- Strongly connected components and cycles.
- Alternative dependency evaluation.
- Operational criticality ranking.
- Impacted workflow identification.
- Candidate containment boundary analysis.

Use AI for explanation and recommendations when useful, not as a substitute for testable graph logic.

## 4.7 What-if simulation

Users should be able to select a digital service and simulate:

- Service outage.
- Suspected compromise.
- Network isolation.
- Revocation of a specified integration.
- Reduced service availability.
- Loss of a communications provider.
- Activation of a backup procedure.

The application recalculates operational consequences without affecting production infrastructure.

Users can compare multiple candidate actions and inspect why their results differ.

Risk estimates must be clearly labeled as modeled assumptions rather than definitive security assessments.

---

# 5. Intelligent Graph Pruning

## 5.1 Purpose

During an emergency, an ordinary organization may have hundreds of tasks, messages, documents, and dependencies.

TBD must automatically prioritize information relevant to the incident.

This is not simply hiding random nodes.

It is an incident-aware transformation of the workspace.

## 5.2 Crisis Mode

When Crisis Mode activates, the application should:

1. Identify directly affected services.
2. Traverse relevant operational dependencies.
3. Surface critical downstream workflows.
4. Identify responsible people.
5. Highlight active response tasks.
6. Surface approved fallback procedures.
7. Identify communication and approval requirements.
8. Collapse unrelated work.
9. Preserve access to the full original graph.

Nodes should never be deleted merely because they are currently irrelevant.

## 5.3 Priority model

Consider:

- Operational criticality.
- Incident relevance.
- Time sensitivity.
- Downstream impact.
- Number of dependent workflows.
- Current availability.
- Required human intervention.
- Responsibility and approval requirements.
- Confidence in available information.

Develop an explainable scoring mechanism.

Show users why important nodes have been prioritized.

## 5.4 Personalized views

### Manager view

Show critical operations, task ownership, approval requests, bottlenecks, and recovery progress.

### Employee view

Show immediate responsibilities, relevant instructions, critical announcements, and available support.

### Incident commander view

Show affected systems, evidence, containment options, operational risks, and response status.

### Individual emergency view

Show contacts, local alerts, essential instructions, and available communication paths.

## 5.5 Exit and recovery

Users can return to normal workspace mode.

Incident-generated changes remain in the event history.

The original organization graph must remain intact.

---

# 6. Resilient Peer-to-Peer Mesh Communication

## 6.1 Purpose

This is a core differentiating capability.

TBD should continue supporting local coordination even when cloud-based communications are unavailable.

The system should use a hybrid communications model:

**Normal connectivity:** Messages synchronize through ordinary application infrastructure.

**Degraded connectivity:** Messages are stored locally and transmitted when possible.

**Local offline connectivity:** Nearby participating devices discover one another and exchange messages directly.

**Multi-hop connectivity:** Where implemented and supported, intermediate devices relay messages to recipients beyond a single direct connection.

A local mesh is not a substitute for all forms of internet connectivity. Its practical reach depends on device proximity, radio availability, permissions, operating-system constraints, and network conditions.

## 6.2 User experience

The user should not need to configure networking protocols.

The interface should display simple delivery information:

- Sent
- Delivered to nearby peer
- Relayed
- Received by recipient
- Acknowledged
- Queued
- Delivery uncertain
- Failed

Do not treat successful transmission to a relay as successful delivery to the destination.

## 6.3 Messaging capabilities

Support:

- Direct messages.
- Incident-wide announcements.
- Priority alerts.
- Task-linked communication.
- Manager-to-employee instructions.
- Local availability check-ins.
- Acknowledgments.
- Critical operational status updates.
- Store-and-forward delivery.
- Eventual synchronization with the backend when connectivity returns.

The conceptual unified chat should behave as a structured incident feed rather than a giant, unfiltered group conversation.

## 6.4 Identity and cryptography

Generate device-associated cryptographic identity keys using established libraries.

Support an appropriate contact verification process, such as scanning a QR code or confirming a short authentication code.

Messages should carry authenticated sender information.

Provide end-to-end encryption for sensitive message contents where feasible.

Use authenticated message envelopes with:

- Message ID.
- Sender key identifier.
- Intended recipient or group.
- Incident identifier.
- Timestamp.
- Expiration information.
- Replay protection.
- Signature or authentication tag.
- Delivery state.

Forwarding devices should not need access to encrypted message contents.

A valid digital signature proves a relationship to a trusted key. It does not independently establish the human identity of the sender or guarantee that the content is accurate.

## 6.5 Multi-hop relay protocol

The transport layer should support:

- Peer discovery.
- Peer connection establishment.
- Message forwarding.
- Duplicate suppression.
- Hop limits.
- Message expiration.
- Queue management.
- Delivery acknowledgments.
- Reconnection.
- Retry policies.
- Conflict and event ordering.
- Local state persistence.

The MVP should demonstrate a genuine three-device route:

Device A sends a message to Device C through Device B, without requiring A and C to communicate directly.

Measure and display whether messages successfully reach the intended recipient.

Do not claim multi-hop support unless this behavior is actually demonstrated.

## 6.6 Hybrid synchronization

When internet connectivity returns, the application should reconcile local messages and operational events with the shared backend.

Use stable identifiers and idempotent operations to prevent duplicates.

Potentially conflicting actions must be resolved according to explicit rules.

Ordinary chat messages may merge automatically.

Conflicting approvals, infrastructure-control commands, and authority changes must not be blindly merged.

## 6.7 Platform feasibility

Codex must evaluate the actual device targets and available native APIs before selecting a transport.

Potential technologies include:

- Android Nearby Connections.
- Apple Network framework.
- Local Wi-Fi and service discovery.
- Bluetooth or BLE where appropriate.
- Native networking functionality integrated through Tauri.
- A transport abstraction supporting multiple adapters.

Prioritize one proven real transport before attempting universal platform compatibility.

A browser-only WebSocket demonstration on an existing network is not evidence of an infrastructure-independent mesh.

## 6.8 Security limitations

The mesh must account for:

- Malicious relays.
- Message replay.
- Stale emergency information.
- Device compromise.
- Flooding and denial of service.
- Unauthorized group membership.
- Privacy leakage through network metadata.
- Lost or stolen devices.
- Conflicting offline commands.

For the MVP, mesh messages may coordinate responses and collect proposals.

High-risk infrastructure actions must not execute merely because a disconnected device receives a purported command.

---

# 7. Infrastructure Containment and Automatic Shutdown

## 7.1 Purpose

TBD should support controlled protective action, not just incident observation.

The user should be able to evaluate what happens if an affected service is isolated, then execute approved actions against supported infrastructure when authorization and connectivity permit.

This creates a direct relationship between graph intelligence and operational control.

## 7.2 Containment actions

Potential supported actions include:

- Disable a specific nonessential service.
- Isolate a designated test host or container.
- Block a predefined network route.
- Revoke or disable a specified integration.
- Disable a narrowly scoped automation.
- Place a service into maintenance mode.
- Restrict a predefined privileged access path.

Implementation must use documented service-control APIs, trusted execution environments, and properly scoped credentials.

Never assume that simply removing a visual graph connection isolates a real service.

## 7.3 Three execution modes

### Mode A: Simulation

The system models an action and displays anticipated consequences.

No actual infrastructure is modified.

### Mode B: Human-approved execution

An authorized user reviews the action, affected resources, expected consequences, and rollback procedure before executing it.

### Mode C: Policy-controlled automatic containment

An administrator preauthorizes a narrow action for a specific environment and specified conditions.

The application may execute that action when the policy is satisfied.

Generic AI recommendations or graph predictions alone must not trigger automatic production shutdowns.

## 7.4 Safety conditions

Every live containment action requires:

- Verified target identity.
- Explicit authorization.
- Scope restrictions.
- Defined trigger conditions.
- Idempotent execution.
- Audit logging.
- Status verification.
- A documented recovery procedure.
- Protection against repeated or conflicting commands.
- Human oversight for high-impact actions.

Where possible, provide tested rollback procedures, but do not promise reversibility for inherently irreversible actions.

The application must display uncertainty when downstream effects are not fully known.

## 7.5 Operational dependency integration

Before a containment action is submitted, TBD should evaluate its potential operational consequences.

For example:

A compromised scheduling integration may need to be disabled.

The graph identifies that volunteer check-in relies on that integration.

TBD offers a previously approved manual check-in procedure.

The authorized user isolates the integration, and the system simultaneously activates the corresponding response workflow.

This is the intended integration between technical containment and operational continuity.

## 7.6 Hackathon execution target

Implement real control only against disposable, isolated demonstration infrastructure.

An example could involve containerized fictional services with no production data.

A containment adapter can disable an explicitly permitted test service.

The application must verify the resulting state through a separate check.

Demonstrate that the graph, tasks, and incident timeline reflect the real control outcome.

Do not connect the hackathon prototype to real business infrastructure.

---

# 8. Operational Continuity and Fallback Execution

## 8.1 Purpose

TBD must help an organization continue its most important activities after a digital service becomes unavailable.

The graph identifies operational consequences.

The fallback engine translates them into actionable recovery procedures.

## 8.2 Fallback procedures

Every fallback should specify:

- Target operation.
- Trigger conditions.
- Required personnel.
- Required resources.
- Safety and security prerequisites.
- Expected operating limitations.
- Approval requirements.
- Response tasks.
- Verification conditions.
- Reconciliation requirements after recovery.

## 8.3 Fallback comparison

The system should compare possible alternatives based on:

- Feasibility.
- Required resources.
- Time sensitivity.
- Operational availability.
- Security assumptions.
- Human effort.
- Critical dependencies.
- Known limitations.

Avoid fabricated percentage-based risk scores without validated models.

## 8.4 Execution

Activating a fallback should:

1. Record the selected plan.
2. Validate approval requirements.
3. Generate the required response tasks.
4. Assign owners.
5. Send notifications through available channels.
6. Track acknowledgments.
7. Track task completion.
8. Verify that prerequisites are satisfied.
9. Recalculate the operational graph.
10. Record the transition in an auditable incident history.

## 8.5 Recovery

The application must distinguish a temporary fallback from actual restoration.

For example, a food pantry may resume distribution through manual check-in while its scheduling system remains unavailable.

TBD should report distribution as operating on fallback, not claim that the scheduling provider has recovered.

Once normal services return, the application should help coordinate record reconciliation and close temporary workflows.

---

# 9. Unified Communication and Human Coordination

## 9.1 Incident command workspace

Each incident has a shared workspace containing:

- Incident summary.
- Current impact.
- Critical announcements.
- Relevant personnel.
- Assigned tasks.
- Communication activity.
- Pending approvals.
- Agent proposals.
- Operational status.
- Response timeline.

## 9.2 Unified communication without information overload

All relevant incident participants should have access to a common coordination context, subject to authorization.

However, this does not mean every participant sees every message.

Use:

- Organization-wide incident announcements.
- Role-based message visibility.
- Task-specific discussions.
- Priority filtering.
- Contextual threads.
- Personal action inboxes.

## 9.3 Manager and employee dynamics

Managers should be able to:

- View team availability.
- Assign and reassign tasks.
- Review operational bottlenecks.
- Approve response plans.
- Identify unanswered critical messages.
- Escalate unresolved work.

Employees should be able to:

- View immediate responsibilities.
- Acknowledge assigned work.
- Report operational difficulties.
- Request assistance.
- View trusted instructions.
- Complete response tasks.

## 9.4 Incident command hierarchy

Organizational seniority and incident authority must be modeled separately.

A person may manage a team without having permission to approve infrastructure containment.

Support explicit roles such as:

- Organization administrator.
- Incident commander.
- Operational coordinator.
- Technical responder.
- Participant.
- AI agent.

---

# 10. Security and Authority Abstraction

## 10.1 Objective

Users should understand what they can do without needing to understand complex authorization systems.

Translate permissions into understandable interface states.

Examples:

'You can report this issue.'

'Manager approval required.'

'This action affects three critical workflows.'

'You are authorized to activate this backup procedure.'

## 10.2 Authorization

Implement centralized, server-enforced access control.

Use roles and narrowly scoped permissions for incident and infrastructure actions.

MCP agents must use the same authorization service.

Offline requests must not bypass centrally enforced restrictions.

## 10.3 Approvals

Approval records should include:

- Action.
- Requester.
- Approver.
- Target.
- Expected effects.
- Authorization scope.
- Timestamp.
- Expiration.
- Execution outcome.

All sensitive state transitions must be auditable.

## 10.4 Trusted local identities

The application may establish verified device identities for local communication.

Local identity verification does not automatically confer organizational authority.

The system must distinguish:

- Cryptographic device identity.
- Human or organizational identity.
- Role membership.
- Authorization to perform actions.

## 10.5 Degraded connectivity

When central authorization cannot be verified, the system should continue allowing low-risk local coordination.

Preissued, narrowly scoped, verifiable permissions may support selected offline workflows.

Privileged infrastructure changes should not be accepted from arbitrary locally received messages.

---

# 11. MCP and Agent-Native Architecture

## 11.1 Objective

TBD must allow authorized AI agents to interact with the same incident state, organizational graph, tasks, approvals, and communications used by human participants.

MCP is the interoperability layer, not the entire agent runtime.

## 11.2 MCP server

Implement a standards-compliant MCP server exposing structured resources and tools.

The interface should use shared application services rather than duplicate business logic.

## 11.3 Proposed tools

### Incident intelligence

- `get_incident`
- `list_incidents`
- `get_incident_timeline`
- `analyze_incident_impact`
- `get_critical_operations`

### Graph operations

- `query_graph`
- `get_dependencies`
- `get_pruned_graph`
- `simulate_service_failure`
- `compare_containment_strategies`

### Operational response

- `list_fallback_plans`
- `propose_fallback_plan`
- `list_response_tasks`
- `propose_task_assignment`
- `request_approval`

### Communication

- `get_incident_messages`
- `draft_incident_announcement`
- `post_authorized_message`
- `get_delivery_status`

### Infrastructure control

- `list_permitted_actions`
- `simulate_containment`
- `propose_containment`
- `get_execution_status`

Actual containment execution should be implemented through a separate, strongly authorized service, not unrestricted model-generated tool calls.

## 11.4 Specialized agents

Explore a small council of operational agents:

**Impact Analyst:** Determines which operations may be affected by an incident.

**Containment Planner:** Compares possible isolation measures and their modeled consequences.

**Continuity Coordinator:** Identifies and proposes fallback operations.

**Communications Coordinator:** Prepares clear incident updates and directs information to relevant personnel.

**Risk Reviewer:** Challenges assumptions, identifies missing evidence, and flags potentially unsafe proposals.

These agents should interact with shared state and return structured recommendations.

The MVP does not require five independently operating agents. A single functioning MCP integration with real tool interactions takes precedence over simulated multi-agent sophistication.

## 11.5 Agent permissions

Agents must have distinct identities and auditable actions.

Default operation should be read-only analysis and proposal generation.

Delegated task creation or routine updates may be permitted under explicit policies.

Agents must not independently modify authorization policies, execute unrestricted infrastructure shutdowns, or misrepresent speculative conclusions as observed facts.

## 11.6 Event-driven behavior

An incident event may trigger an agent runtime to analyze updated state.

The runtime can invoke MCP tools and submit recommendations.

MCP itself does not provide autonomous scheduling or guaranteed event delivery.

Implement explicit event handling if proactive agents are required.

## 11.7 Agent security

Protect against:

- Prompt injection through graph data.
- Malicious incident messages.
- Confused-deputy authorization.
- Privilege escalation.
- Cross-organization data access.
- Untrusted tool output.
- Duplicate actions.
- Stale offline decisions.
- Excessive resource consumption.

All meaningful authorization decisions must occur in trusted application services.

---

# 12. Local-First and Distributed State

## 12.1 Persistence

Maintain a local store of relevant operational data, incident events, messages, and pending actions.

The application should remain useful when the backend is inaccessible.

## 12.2 State synchronization

Use stable event identifiers and idempotent synchronization where feasible.

Support replay protection and duplicate detection.

Conflict handling depends on operation type.

Routine messages may be reconciled automatically.

Conflicting authority changes, incident closures, infrastructure commands, and approvals require stricter validation.

## 12.3 Local incident continuity

When the central server is unreachable:

- Previously cached operational context remains accessible.
- Users can view essential procedures.
- Local messages can continue over supported transports.
- Users can create offline incident notes and task updates.
- Pending changes are clearly labeled.
- The application attempts reconciliation when connectivity returns.

Do not pretend that disconnected devices necessarily possess identical or current organization state.

## 12.4 Offline agent limitations

A remote AI agent cannot operate through MCP when its required compute or network connection is unavailable.

A local model or locally reachable agent runtime may offer offline capabilities, subject to device performance and available data.

MCP connectivity alone does not make an agent offline-capable.

---

# 13. Graphite Integration Strategy

## 13.1 Existing foundation

The Graphite repository reportedly includes:

- React and TypeScript.
- Vite.
- Tauri and Rust.
- Supabase and PostgreSQL.
- Graph-based workspaces.
- Nodes and relationships.
- Tasks and productivity features.
- Offline-first features.
- State management.
- Plugin infrastructure.

Codex must verify these against the actual repository.

## 13.2 Preferred implementation

Create a standalone TBD application, using selected Graphite components and architectural patterns only if inspection demonstrates a net implementation benefit.

Reuse:

- Graph canvas.
- Node and edge rendering.
- Selection and inspection.
- Layout utilities.
- Existing task infrastructure.
- Workspace concepts.
- Local persistence where suitable.
- Shared types and utility modules.

Replace or extend:

- General-purpose node semantics.
- Workspace priorities.
- Dependency evaluation.
- Incident state.
- Communications transport.
- Access-control rules.
- Infrastructure-control adapters.
- MCP service interfaces.

## 13.3 Fallback strategy

If extraction becomes too expensive, create a separate fork of Graphite and add a dedicated TBD workspace or mode.

Remove or hide unnecessary productivity features within the fork.

Preserve the original completed application.

Never alter Graphite production data or infrastructure as part of the hackathon prototype.

## 13.4 Architectural boundaries

Keep separate modules for:

- Graph model and evaluation.
- Incident state machine.
- Priority and pruning engine.
- Communications protocol.
- Synchronization engine.
- Containment policy and execution.
- Task and fallback workflow.
- Authorization and audit.
- MCP integration.
- User interface.

All modules should interact through defined application services.

---

# 14. Interface and User Experience

## 14.1 Main interface

TBD should offer an accessible emergency workspace consisting of:

**Operational overview:** Current incident status and essential functions.

**Interactive graph:** People, services, tasks, dependencies, failures, and fallback relationships.

**Communications panel:** Shared incident feed, local delivery status, and important announcements.

**Response panel:** Critical tasks, approvals, and recovery workflows.

**Contextual inspector:** Selected node details, dependencies, owners, and available actions.

## 14.2 Normal Mode

Display ordinary organizational operations, tasks, service health, and communication.

Avoid excessive complexity.

## 14.3 Crisis Mode

Restructure the workspace around the incident.

Surface directly affected operations, immediate responsibilities, communications, and response controls.

Use graph pruning to reduce clutter.

## 14.4 Simulation Mode

Users can test hypothetical failures before a real emergency.

They can compare containment actions and fallback strategies.

Simulated events and results must be visually distinct from actual system observations.

## 14.5 Communication Mode

Provide an accessible interface for local messages, incident announcements, contact verification, and delivery status.

Nontechnical users should not need to understand relay routing.

## 14.6 Accessibility

Support:

- High contrast.
- Keyboard navigation.
- Textual alternatives to graph relationships.
- Clear status explanations.
- Distinct warning levels.
- Simplified task instructions.
- Error recovery.
- Minimal reliance on color alone.

---

# 15. Representative End-to-End Demonstration

## Scenario: Community Food Pantry Under Cyber Disruption

### Scene 1: Normal operations

Display a fictional food pantry with:

- Staff and volunteers.
- Volunteer scheduling provider.
- Inventory system.
- Donation processing.
- Communications provider.
- Distribution workflow.
- Emergency resources.
- Approved fallback procedures.

The operational graph should show meaningful dependencies.

### Scene 2: Suspected compromise

A simulated suspicious event affects the volunteer scheduling provider.

TBD distinguishes the reported observation from any unverified claim about the root cause.

The incident is opened.

### Scene 3: Intelligent graph pruning

Crisis Mode activates.

Low-priority nodes collapse.

The scheduling provider, dependent operations, key staff, and available fallback procedures come into focus.

### Scene 4: Operational impact

The graph shows that volunteer check-in and distribution staffing are affected.

The system explains each dependency path.

### Scene 5: Containment planning

The application compares leaving the integration active, restricting it, and isolating the disposable test service.

The operational effects of each action are displayed.

### Scene 6: Controlled isolation

A predefined authorized containment policy permits isolation of the simulated compromised integration.

TBD invokes an isolated test infrastructure adapter.

The adapter performs the real test action.

The application verifies the outcome and records it.

### Scene 7: Fallback activation

An approved backup roster provides an alternate means of coordinating volunteers.

TBD generates tasks for the appropriate coordinator and participants.

### Scene 8: Communication disruption

The normal communication channel becomes unavailable.

Nearby devices discover each other.

One device forwards an authenticated emergency message between two other devices.

The intended recipient acknowledges the message.

### Scene 9: MCP agent participation

A connected AI agent reads the incident graph and current task state.

It identifies an unresolved operational dependency and proposes a response.

The proposal appears in the shared workspace.

A human coordinator approves an appropriate action.

### Scene 10: Recovery

Tasks are completed and verified.

The graph shows food distribution operating under the approved fallback.

The incident timeline records observations, decisions, actions, and results.

The system does not claim that the original provider is secure or fully recovered until independent verification occurs.

---

# 16. Hackathon Implementation Plan

The complete product vision is intentionally ambitious.

The implementation should prioritize one vertically integrated scenario instead of many isolated demonstrations.

## Milestone 1: Functional graph

Deliver:

- Graphite-derived canvas.
- Operational node and edge types.
- Seeded organizational dataset.
- Deterministic dependency propagation.
- Incident-aware graph pruning.

Acceptance test: A simulated service failure changes downstream operational states and highlights relevant graph nodes.

## Milestone 2: Executable continuity

Deliver:

- Fallback comparison.
- Plan approval.
- Persistent task creation.
- Task acknowledgment and completion.
- Operational state recalculation.

Acceptance test: Activating and completing a fallback plan actually changes the modeled workflow state.

## Milestone 3: Containment control

Deliver:

- Simulated containment comparison.
- Policy-controlled action service.
- Disposable test infrastructure.
- Real execution acknowledgment.
- Independent status verification.
- Audit events.

Acceptance test: An authorized action changes the state of an isolated test service, and TBD reflects the verified outcome.

## Milestone 4: Local mesh communication

Deliver:

- Two-device offline messaging.
- Three-device relay.
- Message authentication.
- Queueing and deduplication.
- Delivery acknowledgment.
- Basic reconnection behavior.

Acceptance test: Device A reaches Device C through Device B while A and C lack a direct application transport connection and no internet service is used.

## Milestone 5: MCP integration

Deliver:

- Working MCP server.
- Authenticated agent identity.
- Read-only graph and incident tools.
- Structured response proposal.
- Approval integration.
- Visible agent activity.

Acceptance test: A real MCP client retrieves incident state and submits a proposal that appears in the application.

## Milestone 6: Integrated presentation

Deliver:

- Polished Crisis Mode.
- Cohesive navigation.
- Accessible copy.
- Stable seeded data.
- Reliable demonstration controls.
- Automated tests.
- End-to-end incident flow.

Acceptance test: The complete scenario can be demonstrated without manual database edits or invented execution results.

## Prioritization principle

All six systems remain in the product specification.

Under time pressure, preserve the deepest working integrations instead of adding shallow approximations.

A verified two-device direct connection is more valuable than a fake multi-hop simulation.

A real disposable-service containment action is more valuable than a button that only changes a graph color.

One properly authenticated MCP agent is more valuable than five decorative chatbots.

A smaller functioning implementation is preferable to a broad interface that misrepresents capabilities.

---

# 17. Success Metrics

## Graph intelligence

- Correct downstream dependency propagation.
- Correct handling of alternative dependencies.
- Correct handling of unknown states.
- Explainable criticality ranking.
- Non-destructive pruning.

## Communication

- Successful direct offline messaging.
- Successful multi-hop delivery where implemented.
- Correct deduplication.
- Accurate acknowledgment states.
- No false indication of confirmed delivery.

## Containment

- Unauthorized actions rejected.
- Authorized simulation changes no real infrastructure.
- Live test action affects only the permitted disposable target.
- Execution outcome independently verified.
- Complete audit record.

## Operational continuity

- Fallback plans create persistent tasks.
- Approvals are enforced.
- Task state transitions affect operational state only when valid.
- Recovery status reflects actual verification.
- Response history survives application restart.

## Agent integration

- Real MCP client connects.
- Scoped access controls work.
- Agent proposals are visible.
- Agent execution cannot bypass authorization.
- Relevant actions are auditable.

## User experience

- Nontechnical user can identify affected operations.
- Nontechnical user can understand proposed alternatives.
- Participants can find and acknowledge assigned tasks.
- Critical functions are accessible without navigating the entire graph.

---

# 18. Security and Threat Model

Potential threats include:

- Compromised accounts.
- Impersonated employees.
- Malicious relay nodes.
- Message replay.
- Prompt injection.
- Unauthorized containment commands.
- Privilege escalation.
- Data leakage.
- Offline state conflicts.
- Stale emergency instructions.
- Compromised backend services.
- Denial-of-service attacks.
- Incorrect dependency mappings.
- Misleading AI recommendations.
- Unauthorized changes to organizational roles.

Security requirements:

- Authentication and scoped authorization.
- Standard cryptographic libraries.
- Secure key storage where available.
- Auditable state changes.
- Conservative handling of unknown states.
- Server-enforced permissions.
- Signed, scoped, and expiring offline authorizations where needed.
- Human review of consequential changes.
- Isolated test infrastructure.
- Explicit separation between simulations and production control.

TBD's own services must not become an unrestricted management backdoor into an organization.

---

# 19. Competitive Positioning

TBD must not compete by claiming to replace existing platforms.

GitHub manages software development and code collaboration.

Slack and Microsoft Teams handle communication.

Incident-management tools manage alerts, escalations, and response workflows.

Business continuity platforms support planning, dependency analysis, and recovery procedures.

Offline messaging tools support selected forms of decentralized communication.

TBD's intended differentiator is the integration of these concerns into one accessible, executable resilience model.

The defining workflow is:

**Detect or report disruption -> Understand operational impact -> Evaluate containment -> Coordinate through available networks -> Activate fallback -> Verify continued operation**

The product is valuable only if this integration produces better decisions or response outcomes than conventional tools.

The hackathon prototype should demonstrate that advantage with measurable and observable results.

---

# 20. Product Risks

## Risk A: Feature overload

The entire architecture may be too ambitious for the available development time.

Mitigation: Build one integrated scenario; reuse Graphite only after verifying its availability, license, fit, and extraction cost.

## Risk B: A visualizer rather than a functioning platform

The application may look sophisticated without changing real workflows.

Mitigation: Require persistent tasks, verified state transitions, and real transport or control mechanisms.

## Risk C: Mesh networking complexity

Device-specific restrictions may prevent reliable multi-platform networking.

Mitigation: Implement and validate a single transport before expanding platform support.

## Risk D: Dangerous automation

Infrastructure isolation can cause outages or unexpected side effects.

Mitigation: Use policy-scoped actions, preexecution simulation, human approvals, test environments, and verified outcomes.

## Risk E: Incomplete graph knowledge

An organization may not know all its digital dependencies.

Mitigation: Support uncertain relationships, guided onboarding, and conservative recommendations.

## Risk F: Agent overreach

AI recommendations could appear more authoritative than the available evidence supports.

Mitigation: Structured proposals, explicit confidence and assumptions, deterministic evaluation, and human authorization.

## Risk G: Audience mismatch

A complex graph interface may intimidate the nontechnical users it intends to help.

Mitigation: Make the action-oriented interface primary and expose graph detail progressively.

---

# 21. Non-Goals for the Initial Release

TBD will not:

- Discover novel zero-day vulnerabilities.
- Guarantee that a service is free from compromise.
- Provide unrestricted autonomous incident remediation.
- Automatically shut down unknown production infrastructure.
- Guarantee message delivery beyond available local connectivity.
- Provide nationwide emergency communications.
- Replace emergency services.
- Replace enterprise incident management systems.
- Replace existing source control systems.
- Guarantee offline consensus across disconnected organizations.
- Infer complete security posture from incomplete graph data.

These limitations do not prevent the application from implementing real local communications, legitimate containment controls, or operational recovery workflows within clearly defined boundaries.

---

# 22. Design and Engineering Acceptance Criteria

The product is ready for its hackathon demonstration when the following are true:

1. A realistic organization can be represented as a typed dependency graph.
2. An incident produces explainable operational impact.
3. Crisis Mode automatically reduces irrelevant visual clutter.
4. At least two response strategies can be compared.
5. A predefined containment action can be safely executed against disposable infrastructure.
6. The containment outcome is independently verified.
7. A fallback plan generates persistent assignments.
8. Participants can complete and acknowledge their responsibilities.
9. The graph reflects resulting operational state.
10. Real devices can exchange messages without internet access.
11. Multi-hop delivery is demonstrated before being claimed.
12. An MCP-connected agent can read incident context and submit an actionable proposal.
13. Relevant privileged actions require authorization.
14. The complete demonstration maintains an incident audit trail.
15. A nontechnical viewer can understand what failed, why it matters, and how TBD helped.

---

# 23. Final Product Narrative

When sophisticated cyber incidents occur, the people most affected are not always those best equipped to respond.

Organizations with extensive resources can rely on specialized teams and established infrastructure.

A local nonprofit, small business, or ordinary family may not have comparable support.

TBD helps close that gap.

It understands which essential activities depend on vulnerable or unavailable technology.

It identifies operational consequences, highlights what matters, and evaluates safer ways to continue.

It supports controlled containment where authorized.

It maintains communication across nearby devices when centralized connectivity is unavailable.

It coordinates employees, volunteers, managers, and AI agents through shared tasks and explicit permissions.

Most importantly, it converts a digital emergency into understandable decisions and executable actions.

**TBD is not designed to make people cybersecurity experts. It is designed to help them continue functioning when cybersecurity fails.**
