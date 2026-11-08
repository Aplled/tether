# Interaction rebuild contract — November 8, 2026

The user's hands-on review rejected the first interface. This rebuild is assessed through the same user flows, not through test totals alone. Three explicitly upgraded GPT-6 Astra workers own backend, canvas, and interface modules. The lead owns integration, permission review, documentation, and browser verification. Graphite source remains read-only.

## Product language and navigation

- A **workspace** is a saved collection of systems and collaborators for normal company work. It is separate from an incident.
- An **incident** records a reported problem, its priority, affected or suspected systems, responders, tasks, conversation, and reviewed actions.
- The main application has named, closable tabs for maps, workspaces, incidents, and normal conversations. Incident work uses the main page, not a narrow sidebar.
- Use “Create incident”, “Create workspace”, “Assign task”, “Agent prompt”, “Available responders”, “Save changes”, “Open in VS Code”, and clear outcomes. Technical identifiers and raw tool records belong in optional details.
- Every nested form or source/prompt view has Back. Single-click selects a node; its actions remain visible. Right-click exposes node/connection actions. Double-click may open editing.

## Shared wire additions

Existing authentication, current-role/resource checks, exact-action approvals, and isolated service boundaries remain enforced. SQLite changes are additive and retain existing data.

`state.workspaces`: `{id,name,nodeIds,memberIds,createdBy,revision,createdAt,updatedAt}[]`.

- `workspace.create {name,nodeIds,memberIds}`
- `workspace.update {id,revision,patch:{name?,nodeIds?,memberIds?}}`
- `workspace.delete {id,revision}`

Workspace editing requires existing organization administration. Reading requires current membership or administration, and node IDs are intersected with current graph permissions. Joining a workspace grants no private source, incident, or approval access.

`state.conversations`: `{id,scope:'company'|'workspace',workspaceId?,authorId,text,sequence,createdAt}[]`.

- `conversation.send {scope,workspaceId?,text}` with the action idempotency key.
- Company conversation is ordinary shared company communication for active authenticated members. Workspace conversation checks current workspace membership. Private incident content is never copied into these channels automatically.
- Recipient-specific event streams update messages without replacing a user's composer or reloading the page. Display local times and a scrollable history.

`Incident.priority`: `low|medium|high|critical`; create accepts it and `incident.update` can change it with current assignment authority. Resolution still requires the verified response path.

Public `member.availability` is the effective status derived from actual hours, leave, accepted on-call window, and preference. Own/admin full members also expose `availabilitySetting` for editing the stored preference. Presence never grants authority.

`repository.save` accepts optional `id,revisionNumber` for editing; `repository.update` uses the same full payload, and `repository.delete {id,revisionNumber}` removes the mapping with current authority. Source access remains allowlisted. VS Code links can reference only a validated current working-tree source file, never an arbitrary client URL.

Analysis adds a readable `report` alongside retained technical evidence. Response projection includes actual observed outcomes. No UI claim of execution, repair, fallback, or resolution comes from model text alone.

## Canvas integration

`TetherCanvas(root, callbacks)` supports selection, edge selection, context menus, editing, connecting, layout changes, deletion, and viewport changes. Canvas click selects without opening an obstructing editor. Edge labels default off.

`setData`, `setFilter`, `setFocus`, `setEdgeLabels`, `organize`, `fit`, `zoomBy`, `beginConnect`, `clearSelection`, `deleteSelection`, and `dispose` are the agreed methods. Workspace and incident focus physically filter unrelated nodes and edges.

`graph.organize {nodeIds?}` uses current administration, a real bounded MCP `organize_canvas` layout-proposal tool, and revision-checked trusted layout saves. It changes positions only. The pure organization algorithm is shared with the canvas; it retains cycles and connections while preventing card overlap. It has no execution or grant capability.

## Required browser acceptance

1. Type a name normally in directory search; verify order, caret, filtering, clearing, and no input replacement. Change availability and confirm selected text, persistence, and effective presence.
2. Organize the map, fit it, select one node, use right-click and visible selection actions, edit it without horizontal page scrolling, connect two nodes with a chosen relationship, then edit and delete that connection.
3. Create two real workspaces with searchable checkbox selections, select-all/clear, named tabs, and distinct visible systems. Reopen both and confirm saved membership.
4. Create an incident from one node and from a group. Select priority and responders by search/filter, open it as a full-size tab, and edit the responders afterward.
5. Assign a task, change its status, open its Agent prompt, copy it, and go Back to the same incident section. Source preview and editor links use actual permitted files.
6. Send ordinary company/workspace messages and private incident messages across separate authenticated accounts. Verify scrolling, local times, preserved drafts, permissions, and notifications.
7. Run analysis and read a plain-English summary and next steps. Technical JSON, function names, hashes, and target generations are collapsed. Review actual affected service/action and understandable independent observations before resolving.
8. Inspect desktop layouts at 1280×720 and a larger window for overflowing containers, unintended horizontal scroll, clipped navigation, inconsistent controls, unusable pickers, and loss of state on live updates. The user's latest desktop-only instruction supersedes portrait/mobile work for this rebuild.
9. Use a fresh-context reviewer who has no source or builder walkthrough. Recheck all four logins, setup, ordinary workspaces, incident collaboration, analysis, actual action outcomes, and unrelated incidents. Repeat after meaningful fixes. Backend tests do not substitute for these browser paths.
10. Completed-check replay uses recorded successful tool checks, distinct plain labels, and scoped highlights. It is explicitly labeled as recorded review and does not simulate a live service change.

The lead will save actual screenshots and verification notes for these paths before calling the rebuild ready. Supabase migration, production deployment, and unrelated Flowstate changes are outside this rebuild.
