import { icon } from "./icons.js";

export const escapeHtml = (v = "") =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const initials = (name = "?") =>
  name
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2);
const targetLabel = (target) =>
  typeof target === "string"
    ? target
    : target?.identity
      ? `${target.identity}${target.generation !== undefined ? ` · generation ${target.generation}` : ""}`
      : target?.serviceId ||
        target?.componentId ||
        target?.adapter ||
        target?.kind ||
        "Fixed isolated response target";
const analysisMarkup = (analysis) => {
  if (!analysis) return "";
  const mode =
    analysis.mode === "scripted"
      ? "Rule-based plan"
      : analysis.mode === "live"
        ? analysis.provider || "Live provider"
        : "AI unavailable";
  const protocol = analysis.mcp?.protocolVersion;
  return `<article class="analysis"><div><span class="provider">${escapeHtml(mode)}${protocol ? ` · MCP ${escapeHtml(protocol)}` : ""}</span><b>Analysis result</b></div><p>${escapeHtml(analysis.summary || "No scoped result returned.")}</p>${analysis.mode === "scripted" && analysis.reason ? `<p><b>Rule-based fallback reason:</b> ${escapeHtml(analysis.reason)}</p>` : ""}${(analysis.steps || []).map((step, index) => `<div class="analysis-step"><span>${index + 1}</span><div><b>${escapeHtml(step.tool || "Scoped check")}</b><small>${escapeHtml(step.status || "unknown")}</small><p>${escapeHtml(step.detail || "No detail returned.")}</p></div></div>`).join("")}${analysis.recommendation ? `<p><b>Recommendation:</b> ${escapeHtml(analysis.recommendation)}</p>` : ""}</article>`;
};
const coverageMarkup = (coverage, members) => {
  if (!coverage) return "";
  return `<article class="analysis"><b>Point-in-time coverage</b><p>${coverage.approvalBlocked ? "No eligible approver is currently available. Risky actions remain blocked." : "An eligible responder is available for the current scope."}</p>${(coverage.candidates || []).map((candidate) => `<div class="coverage-row"><span class="task-state">${candidate.eligible ? "eligible" : "skipped"}</span><div><b>${escapeHtml(members.find((member) => member.id === candidate.memberId)?.name || candidate.memberId)}</b><small>${escapeHtml(candidate.route || "coverage")}${candidate.reasons?.length ? ` · ${escapeHtml(candidate.reasons.join(" · "))}` : ""}</small></div></div>`).join("") || "<p>No coverage candidates were returned.</p>"}</article>`;
};
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`;

export function nodeInspector(node, canEdit, edges = [], nodes = []) {
  if (!node) return "";
  const repo = node.repository || node.repo || {};
  return `<aside class="sheet inspector" data-sheet="inspector"><header><div><span class="eyebrow">${escapeHtml(node.type)}</span><h2>${escapeHtml(node.name)}</h2></div><button type="button" class="icon-button" data-close="inspector" aria-label="Close">${icon("close")}</button></header>
    <div class="sheet-scroll"><div class="status-line"><span class="status-dot ${escapeHtml(node.state || "healthy")}"></span>${escapeHtml(node.state || "healthy")} · ${escapeHtml(node.region || "No region")}</div>
    <p class="body-copy">${escapeHtml(node.description || "No description added.")}</p>
    <section class="detail-block"><h3>Owner</h3><p>${escapeHtml(node.ownerName || "Unassigned")}</p></section>
    <section class="detail-block"><h3>Repository reference</h3>${repo.path ? `<code>${escapeHtml(repo.path)}${repo.lineStart ? `:${repo.lineStart}` : ""}</code><button class="soft-button" data-copy="${escapeHtml(repo.path)}">${icon("copy")} Copy path</button>` : "<p>No source reference mapped.</p>"}</section>
    <section class="detail-block"><h3>Relationships</h3><div id="node-relations">${
      edges
        .filter(
          (e) =>
            (e.sourceId || e.from) === node.id ||
            (e.targetId || e.to) === node.id,
        )
        .map((e) => {
          const otherId =
              (e.sourceId || e.from) === node.id
                ? e.targetId || e.to
                : e.sourceId || e.from,
            other = nodes.find((n) => n.id === otherId);
          return `<div class="relation-row"><span>${escapeHtml(e.label || e.kind || "depends on")} · ${escapeHtml(other?.name || otherId)}</span>${canEdit ? `<button class="icon-button" data-delete-edge="${escapeHtml(e.id)}" data-revision="${escapeHtml(e.revision || 1)}" aria-label="Remove relationship">${icon("close")}</button>` : ""}</div>`;
        })
        .join("") || "<p>No relationships.</p>"
    }</div></section>
    <div class="button-row">${canEdit ? `<button class="primary" data-edit-node="${escapeHtml(node.id)}">Edit node</button><button class="danger-soft" data-delete-node="${escapeHtml(node.id)}">Delete</button>` : ""}${repo.id ? `<button class="soft-button" data-source="${escapeHtml(repo.id)}">Open source</button>` : ""}</div></div></aside>`;
}

export function nodeForm(node = {}, people = [], regions = []) {
  const repo = node.repository || {};
  return `<form class="sheet form-sheet" id="node-form"><header><div><span class="eyebrow">Company graph</span><h2>${node.id ? "Edit node" : "Add node"}</h2></div><button type="button" class="icon-button" data-close="form" aria-label="Close">${icon("close")}</button></header><div class="sheet-scroll">
    <input type="hidden" name="id" value="${escapeHtml(node.id || "")}">${field("Name", "name", node.name, "text", 'required maxlength="80"')}
    <label><span>Type</span><select name="type">${["service", "component", "workflow", "dataset", "resource", "person", "team"].map((k) => `<option ${k === (node.kind || node.type) ? "selected" : ""}>${k}</option>`).join("")}</select></label>
    <label><span>Description</span><textarea name="description" required maxlength="360">${escapeHtml(node.description || "")}</textarea></label>
    <div class="field-grid"><label><span>Region</span><select name="regionId" required>${regions.map((r) => `<option value="${escapeHtml(r.id)}" ${r.id === (node.regionId || node.region) ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("")}</select></label><label><span>Owner</span><select name="ownerId"><option value="">Unassigned</option>${people.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === node.ownerId ? "selected" : ""}>${escapeHtml(p.name || p.displayName)}</option>`).join("")}</select></label></div>
    <fieldset><legend>Repository reference</legend>${field("Repository", "repository", repo.repository || repo.name || "")}${field("Pinned revision", "revision", repo.revision || "")}${field("File path", "path", repo.path || "")}<div class="field-grid">${field("Start line", "lineStart", repo.lineStart || "", "number", 'min="1"')}${field("End line", "lineEnd", repo.lineEnd || "", "number", 'min="1"')}</div></fieldset>
    <p class="form-error" role="alert"></p><button class="primary wide" type="submit">${node.id ? "Save changes" : "Create node"}</button></div></form>`;
}

export function peopleView(people, filters = {}, editable = false) {
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean))];
  return `<main class="page people-page"><header class="page-header"><div><span class="eyebrow">Company directory</span><h1>People</h1><p>${people.length} profiles · schedules and access stay attached to each membership</p></div>${editable ? `<div class="page-actions"><button class="soft-button" data-import="people">Import CSV</button><button class="primary" data-add-person>${icon("plus")} Add person</button></div>` : ""}</header>
  <div class="filter-bar"><label class="search-field">${icon("search")}<input id="people-search" placeholder="Search name, title or team" value="${escapeHtml(filters.q || "")}"></label><select id="department-filter"><option value="">All departments</option>${depts.map((d) => `<option ${d === filters.department ? "selected" : ""}>${escapeHtml(d)}</option>`).join("")}</select><select id="availability-filter"><option value="">Any availability</option><option>available</option><option>focused</option><option>in a meeting</option><option>away</option><option>off hours</option><option>on call</option></select></div>
  <section class="people-grid">${people.map((p) => `<article class="person-card" data-person="${escapeHtml(p.id)}"><div class="person-top"><span class="avatar large">${escapeHtml(initials(p.name || p.displayName))}</span><span class="presence ${escapeHtml(p.availability || "away")}"></span>${editable ? `<button class="icon-button" aria-label="Edit ${escapeHtml(p.name || p.displayName)}" data-edit-person="${escapeHtml(p.id)}">•••</button>` : ""}</div><h3>${escapeHtml(p.name || p.displayName)}</h3><p>${escapeHtml(p.title || "No title")}</p><span class="tag">${escapeHtml(p.department || p.departmentName || "Unassigned")}</span><footer><span>${escapeHtml(p.timezone || "Timezone unset")}</span><b>${escapeHtml(p.availability || "unknown")}</b></footer></article>`).join("")}</section></main>`;
}

export function personForm(person = {}, departments = [], trustedRole = false) {
  trustedRole = trustedRole && Boolean(person.id);
  return `<form class="sheet form-sheet" id="person-form"><header><div><span class="eyebrow">Directory</span><h2>${person.id ? "Edit person" : "Add person"}</h2></div><button type="button" class="icon-button" data-close="form" aria-label="Close">${icon("close")}</button></header><div class="sheet-scroll"><input type="hidden" name="id" value="${escapeHtml(person.id || "")}">${field("Full name", "name", person.name || person.displayName, "text", "required")}${field("Email", "email", person.email, "email", "required")}${field("Display title", "title", person.title, "text", "required")}<label><span>Department</span><select name="departmentId" required>${departments.map((d) => `<option value="${escapeHtml(d.id)}" ${d.id === person.departmentId ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}</select></label>${field("Team", "team", person.team)}${trustedRole ? `<label><span>Trusted access template</span><select name="roleTemplate">${["member", "engineer", "data_science_manager", "marketing", "senior_manager"].map((r) => `<option ${r === (person.roleTemplate || "member") ? "selected" : ""}>${r.replaceAll("_", " ")}</option>`).join("")}</select><small>Titles describe work. This admin-controlled template selects the access baseline; resource grants still limit reach.</small></label>` : ""}<p class="form-error"></p><button type="submit" class="primary wide">${person.id ? "Save changes" : "Add employee profile"}</button></div></form>`;
}

export function importSheet(kind) {
  const sample =
    kind === "people"
      ? "name,email,title,department,team,timezone"
      : "name,type,description,region,ownerEmail,repository,revision,path";
  return `<form class="sheet form-sheet" id="import-form" data-kind="${kind}"><header><div><span class="eyebrow">Bounded import</span><h2>Import ${kind === "people" ? "employees" : "service catalog"}</h2></div><button type="button" class="icon-button" data-close="form" aria-label="Close">${icon("close")}</button></header><div class="sheet-scroll"><p>Preview and confirm before any records are created. Imports accept at most 150 rows.</p><code>${sample}</code><label class="drop-field"><input type="file" name="file" accept="${kind === "people" ? ".csv,text/csv" : ".json,application/json"}" required><span>Choose ${kind === "people" ? "CSV" : "JSON"} file</span></label><div id="import-preview"></div><p class="form-error"></p><button class="primary wide" type="submit" disabled>Confirm import</button></div></form>`;
}

export function incidentDrawer(
  incident,
  user,
  members = [],
  nodes = [],
  permissions = [],
) {
  if (!incident) return "";
  const tasks = incident.tasks || [];
  const messages = incident.messages || [];
  const commander =
    incident.commanderId === user.id || permissions.includes("incident:assign");
  const staleProposal = ["stale_target", "stale_context"].includes(
    incident.proposal?.status,
  );
  return `<aside class="sheet response-sheet" data-sheet="response"><header><div><span class="eyebrow">${escapeHtml(incident.severity || "Incident")} · ${escapeHtml(incident.status || "investigating")}</span><h2>${escapeHtml(incident.title)}</h2></div><button type="button" class="icon-button" data-close="response" aria-label="Close">${icon("close")}</button></header><div class="tabs"><button type="button" class="active" data-incident-tab="overview">Overview</button><button type="button" data-incident-tab="tasks">Tasks <b>${tasks.length}</b></button><button type="button" data-incident-tab="chat">Conversation</button><button type="button" data-incident-tab="action">Response</button></div><div class="sheet-scroll incident-content">
  <section data-tab-content="overview"><h3>Current observation</h3><p>${escapeHtml(incident.observation || incident.description || "No observation recorded.")}</p><div class="button-row"><button type="button" class="primary" data-analyze="${escapeHtml(incident.id)}">Analyze affected path</button><button type="button" class="soft-button" data-focus-incident>Focus nodes</button>${commander ? `<button type="button" class="soft-button" data-check-coverage>Check coverage</button>` : ""}</div><div id="analysis-result">${analysisMarkup(incident.analysis)}</div>${coverageMarkup(incident.coverage, members)}<h3>Assigned response</h3>${
    incident.memberIds
      ?.map((id) => members.find((m) => m.id === id))
      .filter(Boolean)
      .map(
        (r) =>
          `<span class="responder"><span class="avatar">${escapeHtml(initials(r.name))}</span>${escapeHtml(r.name)}</span>`,
      )
      .join("") || "<p>No responders assigned.</p>"
  }${commander ? `<form id="workspace-form"><label><span>Workspace members</span><select name="memberIds" multiple size="5">${members.map((m) => `<option value="${escapeHtml(m.id)}" ${incident.memberIds?.includes(m.id) ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}</select></label><label><span>Workspace nodes</span><select name="nodeIds" multiple size="6">${nodes.map((n) => `<option value="${escapeHtml(n.id)}" ${incident.nodeIds?.includes(n.id) ? "selected" : ""}>${escapeHtml(n.name)}</option>`).join("")}</select></label><button type="submit" class="soft-button">Save workspace scope</button><p class="form-error"></p></form>` : ""}</section>
  <section data-tab-content="tasks" hidden><h3>Scoped tasks</h3>${tasks.map((t) => `<article class="task"><span class="task-state">${escapeHtml(t.status)}</span><b>${escapeHtml(t.title)}</b><small>${escapeHtml(t.ownerName || members.find((m) => m.id === t.ownerId)?.name || "Unassigned")}</small>${t.ownerId === user.id || commander ? `<button type="button" class="soft-button" data-task-brief="${escapeHtml(t.id)}">Review task brief</button><select data-task-status="${escapeHtml(t.id)}">${["assigned", "acknowledged", "investigating", "blocked", "done"].map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}</article>`).join("") || "<p>No tasks yet.</p>"}${
    commander
      ? `<form id="task-form"><h3>Create task</h3><label><span>Task title</span><input name="title" required maxlength="300"></label><label><span>Assignee</span><select name="ownerId" required>${incident.memberIds
          ?.map((id) => members.find((m) => m.id === id))
          .filter(Boolean)
          .map(
            (m) =>
              `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`,
          )
          .join(
            "",
          )}</select></label><label><span>Scoped nodes</span><select name="nodeIds" multiple size="5">${nodes
          .filter((n) => incident.nodeIds?.includes(n.id))
          .map(
            (n) =>
              `<option value="${escapeHtml(n.id)}">${escapeHtml(n.name)}</option>`,
          )
          .join(
            "",
          )}</select></label><button type="submit" class="primary">Create task</button><p class="form-error"></p></form>`
      : ""
  }</section>
  <section data-tab-content="chat" hidden><h3>Workspace conversation</h3><div class="message-list">${messages.map((m) => `<article class="message"><b>${escapeHtml(m.authorName || m.senderName || "Member")}</b><p>${escapeHtml(m.text)}</p><small>${escapeHtml(m.createdAt || "")}</small></article>`).join("") || "<p>No messages yet.</p>"}</div><form id="message-form"><textarea name="text" maxlength="1200" placeholder="Share scoped evidence or a status update" required></textarea><button type="submit" class="primary">Send</button></form></section>
  <section data-tab-content="action" hidden><h3>Exact response</h3><p>The fixed operation disables the affected retry route. Approval is bound to the displayed digest.</p>${incident.proposal ? `<article class="analysis"><b>${escapeHtml(incident.proposal.operation || incident.proposal.action || "Exact response")}</b><p>Target: ${escapeHtml(targetLabel(incident.proposal.target))}</p><code>${escapeHtml(incident.proposal.digest)}</code>${commander && incident.proposal.status === "awaiting_approval" ? `<button type="button" class="primary wide" data-approve-proposal="${escapeHtml(incident.proposal.id)}" data-digest="${escapeHtml(incident.proposal.digest)}">Approve exact action</button>` : staleProposal ? `<span class="status-line">${incident.proposal.status === "stale_target" ? "The local response target restarted. This digest cannot be approved." : "The incident evidence or authority context changed. This digest cannot be approved."}</span>${commander ? `<button type="button" class="soft-button wide" data-prepare-response="${escapeHtml(incident.id)}">Prepare response from current context</button>` : ""}` : `<span class="status-line">Observed response: ${escapeHtml(incident.proposal.status)}</span>`}</article>` : commander ? `<button type="button" class="soft-button" data-prepare-response="${escapeHtml(incident.id)}">Prepare response</button>` : `<p>Only the incident commander can prepare or approve the fixed response.</p>`}<div id="proposal-result"></div>${commander && incident.proposal?.status === "verified" ? `<div class="button-row"><button type="button" class="soft-button" data-fallback="${escapeHtml(incident.id)}">Verify safe fallback</button><button type="button" class="soft-button" data-resolve="${escapeHtml(incident.id)}">Verify resolution</button></div>` : ""}</section>
  </div></aside>`;
}

export function incidentForm(
  nodes = [],
  members = [],
  regions = [],
  selectedIds = [],
) {
  return `<form class="sheet form-sheet" id="incident-form"><header><div><span class="eyebrow">Response workspace</span><h2>Create incident</h2></div><button type="button" class="icon-button" data-close="form" aria-label="Close">${icon("close")}</button></header><div class="sheet-scroll">${field("Title", "title", "", "text", 'required maxlength="100"')}<label><span>Initial observation</span><textarea name="observation" required maxlength="800"></textarea></label><label><span>Region</span><select name="regionId"><option value="">No region</option>${regions.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("")}</select></label><label><span>Affected or suspected nodes</span><select name="nodeIds" multiple size="6" required>${nodes.map((n) => `<option value="${escapeHtml(n.id)}" ${selectedIds.includes(n.id) ? "selected" : ""}>${escapeHtml(n.name)}</option>`).join("")}</select></label><label><span>Responders</span><select name="memberIds" multiple size="5">${members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join("")}</select></label><p class="form-error"></p><button type="submit" class="primary wide">Create workspace</button></div></form>`;
}

export function settingsForm(member = {}) {
  const hours = member.workingHours?.[0] || {
      weekday: 1,
      start: "09:00",
      end: "17:00",
    },
    onCall = member.onCallWindows?.find((w) => w.accepted) || {};
  return `<form class="sheet form-sheet" id="settings-form"><header><div><span class="eyebrow">My preferences</span><h2>Hours and notifications</h2></div><button type="button" class="icon-button" data-close="form" aria-label="Close">${icon("close")}</button></header><div class="sheet-scroll"><label><span>Timezone</span><input name="timezone" value="${escapeHtml(member.timezone || "America/Chicago")}" required></label><div class="field-grid"><label><span>Weekday</span><select name="weekday">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => `<option value="${i}" ${i === hours.weekday ? "selected" : ""}>${d}</option>`).join("")}</select></label><label><span>Availability</span><select name="availability">${["available", "focused", "meeting", "away", "off_hours", "on_call"].map((s) => `<option ${s === member.availability ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}</select></label><label><span>Start</span><input type="time" name="start" value="${escapeHtml(hours.start)}" required></label><label><span>End</span><input type="time" name="end" value="${escapeHtml(hours.end)}" required></label></div><fieldset><legend>Notifications</legend><label class="check"><input type="checkbox" name="routineInHours" ${member.notifications?.routineInHours !== false ? "checked" : ""}> Routine in-hours updates</label><label class="check"><input type="checkbox" name="afterHours" ${member.notifications?.afterHours ? "checked" : ""}> After-hours alerts</label></fieldset><fieldset><legend>Explicit on-call window</legend><label class="check"><input type="checkbox" name="accepted" ${onCall.accepted ? "checked" : ""}> I accept this on-call window</label><label><span>Starts</span><input type="datetime-local" name="onCallStart" value="${escapeHtml(onCall.startsAt?.slice(0, 16) || "")}"></label><label><span>Ends</span><input type="datetime-local" name="onCallEnd" value="${escapeHtml(onCall.endsAt?.slice(0, 16) || "")}"></label></fieldset><p class="form-error"></p><button type="submit" class="primary wide">Save my settings</button></div></form>`;
}

export function setupView(state) {
  return `<main class="page setup-page"><header class="page-header"><div><span class="eyebrow">Admin setup</span><h1>Workspace controls</h1><p>Configure access, source references, and imports.</p></div></header><section class="setup-grid"><article class="raised"><h2>Permission templates</h2><p>Admins assign an access template. Display titles and departments never grant access; resource grants still limit reach.</p>${(state.permissionTemplates || []).map((t) => `<div class="template-row"><div><b>${escapeHtml(t.name)}</b><small>${escapeHtml((t.capabilities || []).join(" · "))}</small></div></div>`).join("") || "<p>Templates are enforced by current memberships and grants.</p>"}</article><article class="raised"><h2>Catalog setup</h2><p>Add company records in bounded batches and inspect every change before confirmation.</p><div class="button-row"><button class="soft-button" data-import="people">Employee CSV</button><button class="soft-button" data-import="catalog">Catalog JSON</button></div></article><article class="raised"><h2>Repositories</h2><p>Repository references are pinned metadata. They do not grant arbitrary URL, file, or shell access.</p>${(state.repositories || []).map((r) => `<div class="repo-row"><b>${escapeHtml(r.repository || r.name)}</b><code>${escapeHtml(r.revision || "unpinned")}</code></div>`).join("") || "<p>Add a reference while editing a node.</p>"}</article><article class="raised"><h2>Escalation</h2><p>Only preauthorized, available delegates can be contacted. Approval stays blocked if no eligible approver exists.</p>${(state.escalation || []).map((e) => `<div class="escalation-row"><span>${escapeHtml(e.order)}</span><div><b>${escapeHtml(e.name)}</b><small>${escapeHtml(e.reason || e.status)}</small></div></div>`).join("") || "<p>No active escalation.</p>"}</article></section></main>`;
}
