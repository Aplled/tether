import { icon } from "./icons.js";
export const escapeHtml = (v = "") =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const h = escapeHtml;
// Presentation only: keep the original report and server audit record intact.
export const displayObservation = (value = "") =>
  String(value ?? "").replace(
    /\n\nResolution evidence: Containment [0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12} and tenant-isolating fallback were independently verified\.$/,
    "",
  );
export const human = (v = "") =>
  String(v ?? "")
    .replaceAll("_", " ")
    .replace(/^./, (s) => s.toUpperCase());
export const initials = (v = "?") =>
  v
    .split(/\s+/)
    .map((x) => x[0])
    .join("")
    .slice(0, 2);
export const field = (label, name, value = "", extra = "") =>
  `<label class="field"><span>${h(label)}</span><input name="${name}" value="${h(value)}" ${extra}></label>`;
export const textField = (label, name, value = "", extra = "") =>
  `<label class="field"><span>${h(label)}</span><textarea name="${name}" ${extra}>${h(value)}</textarea></label>`;
export function picker(
  label,
  name,
  items = [],
  selected = [],
  multiple = false,
  placeholder = "Choose…",
) {
  const ids = (Array.isArray(selected) ? selected : [selected])
    .filter((x) => x !== undefined && x !== null)
    .map(String);
  const options = items.map((x) =>
    typeof x === "string" ? { id: x, name: human(x) } : x,
  );
  const picked = options.filter((x) => ids.includes(String(x.id)));
  return `<div class="field picker" data-picker data-name="${name}" data-multiple="${multiple}"><span>${h(label)}</span><button type="button" class="picker-trigger" aria-expanded="false"><span data-picker-label>${h(picked.length ? (multiple ? `${picked.length} selected` : picked[0].name) : placeholder)}</span><span>⌄</span></button><div class="picker-values">${picked.map((x) => `<input type="hidden" name="${name}" value="${h(x.id)}">`).join("")}</div><div class="picker-popover" hidden><input class="picker-search" type="search" aria-label="Search ${h(label)}" placeholder="Search ${h(label.toLowerCase())}">${multiple ? '<div class="picker-tools"><button type="button" data-select-all>Select all visible</button><button type="button" data-clear-selection>Clear</button></div>' : '<button type="button" data-clear-selection class="picker-clear">Clear selection</button>'}<div class="picker-options">${options.map((x) => `<button type="button" class="picker-option ${ids.includes(String(x.id)) ? "selected" : ""}" data-value="${h(x.id)}" data-label="${h(x.name)}" data-search="${h(`${x.name} ${x.detail || ""}`.toLowerCase())}" role="${multiple ? "checkbox" : "option"}" aria-${multiple ? "checked" : "selected"}="${ids.includes(String(x.id))}"><span class="option-check">${ids.includes(String(x.id)) ? "✓" : ""}</span><span><b>${h(x.name)}</b>${x.detail ? `<small>${h(x.detail)}</small>` : ""}</span></button>`).join("")}</div><small class="picker-empty" hidden>No matches.</small></div></div>`;
}
export const sheet = (
  title,
  body,
  { id = "", subtitle = "", submit = "", wide = false } = {},
) =>
  `<${id ? "form" : "section"} ${id ? `id="${id}"` : ""} class="sheet ${wide ? "wide-sheet" : ""}"><header class="sheet-header"><div><span class="eyebrow">${h(subtitle)}</span><h2>${h(title)}</h2></div><button type="button" class="icon-button" data-close aria-label="Close">${icon("close")}</button></header><div class="sheet-scroll">${body}${id ? `<p class="form-error" role="alert"></p><button class="primary" type="submit">${h(submit || "Save changes")}</button>` : ""}</div></${id ? "form" : "section"}>`;
export function nodeForm(node = {}, people = [], regions = [], admin = false) {
  return sheet(
    node.id ? "Edit node" : "Add node",
    `<input type="hidden" name="id" value="${h(node.id || "")}">${field("Name", "name", node.name, 'required maxlength="80"')}${picker("Type", "kind", ["service", "component", "workflow", "dataset", "resource", "person", "team"], node.kind || "service")}${textField("Description", "description", node.description, 'required maxlength="360"')}<div class="field-grid">${picker("Region", "regionId", regions, node.regionId)}${picker(
      "Owner",
      "ownerId",
      people.map((p) => ({ ...p, detail: p.title })),
      node.ownerId,
    )}</div>${admin ? '<p class="muted">Repository mappings can be edited from Company setup.</p>' : ""}`,
    {
      id: "node-form",
      subtitle: "System map",
      submit: node.id ? "Save node" : "Create node",
    },
  );
}
export function personForm(p = {}, departments = [], admin = false) {
  return sheet(
    p.id ? "Edit person" : "Add person",
    `<input type="hidden" name="id" value="${h(p.id || "")}">${field("Full name", "name", p.name, "required")}${field("Email", "email", p.email, `type="email" required ${p.id ? "readonly" : ""}`)}${field("Job title", "title", p.title, "required")}${picker("Department", "departmentId", departments, p.departmentId)}${field("Team", "team", p.team)}${admin && p.id ? picker("Access template", "roleTemplate", ["member", "engineer", "data_science_manager", "marketing", "senior_manager"], p.roleTemplate || "member") : ""}${admin && p.id ? `<button type="button" class="danger-soft" data-person-active="${h(p.id)}" data-active="${p.active === false ? "true" : "false"}">${p.active === false ? "Reactivate profile" : "Deactivate profile"}</button>` : ""}`,
    {
      id: "person-form",
      subtitle: "Company directory",
      submit: p.id ? "Save profile" : "Add person",
    },
  );
}
export function incidentForm(
  nodes = [],
  members = [],
  regions = [],
  ids = [],
  shareAllowed = true,
) {
  return sheet(
    "Create incident",
    `${field("Incident title", "title", "", 'required maxlength="180" placeholder="What needs attention?"')}${textField("What have you observed?", "observation", "", 'required maxlength="2000" placeholder="Describe the impact and evidence available."')}<div class="field-grid">${picker("Priority", "severity", ["low", "medium", "high", "critical"], "high")}${picker("Region", "regionId", regions, "", false, "All regions")}</div>${picker(
      "Affected or suspected nodes",
      "nodeIds",
      nodes.map((n) => ({ ...n, detail: n.description })),
      ids,
      true,
    )}${picker(
      "Responders",
      "memberIds",
      members.map((m) => ({
        ...m,
        detail: `${m.title} · ${human(m.availability)}`,
      })),
      [],
      true,
    )}${shareAllowed ? '<label class="check share-consent"><input type="checkbox" name="shareSystems" checked><span><b>Share selected systems with responders</b><small>Add read-only system access for this incident. Source files, editing, and approval require separate permissions.</small></span></label>' : ""}<p class="muted">Responders can join this incident’s tasks and conversation. System access follows the sharing choice above.</p>`,
    {
      id: "incident-form",
      subtitle: "Incident response",
      submit: "Create incident",
    },
  );
}
export function workspaceForm(data, workspace = {}, ids = []) {
  return sheet(
    workspace.id ? "Edit workspace" : "Create workspace",
    `<input type="hidden" name="id" value="${h(workspace.id || "")}">${field("Workspace name", "name", workspace.name, 'required maxlength="100" placeholder="e.g. DFW infrastructure"')}${picker(
      "Nodes",
      "nodeIds",
      data.nodes.map((n) => ({ ...n, detail: n.description })),
      workspace.nodeIds || ids,
      true,
    )}${picker("Members", "memberIds", data.members, workspace.memberIds || [data.user.id], true)}${workspace.id ? `<button type="button" class="danger-soft" data-delete-workspace="${h(workspace.id)}">Delete workspace</button>` : ""}`,
    {
      id: "saved-workspace-form",
      subtitle: "Saved system view",
      submit: workspace.id ? "Save workspace" : "Create workspace",
    },
  );
}
export function settingsForm(m = {}) {
  const hours = m.workingHours || [];
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const window = m.onCallWindows?.find((w) => w.accepted) || {};
  return sheet(
    "Hours and notifications",
    `${picker("Availability", "availability", ["available", "focused", "meeting", "away", "off_hours", "on_call"], m.availabilitySetting || m.availability || "available")}${field("Timezone", "timezone", m.timezone || "America/Chicago", 'required placeholder="America/Chicago"')}<fieldset><legend>Weekly working hours</legend><p class="muted">Times use your selected timezone. Leave a day unchecked when you do not work.</p>${days
      .map((day, i) => {
        const w = hours.find((x) => x.weekday === i);
        return `<div class="hours-row"><label class="check"><input type="checkbox" name="day${i}" ${w ? "checked" : ""}>${day}</label><input aria-label="${day} start" name="start${i}" value="${h(w?.start || "09:00")}" placeholder="09:00" pattern="[0-2][0-9]:[0-5][0-9]"><span>to</span><input aria-label="${day} end" name="end${i}" value="${h(w?.end || "17:00")}" placeholder="17:00" pattern="[0-2][0-9]:[0-5][0-9]"></div>`;
      })
      .join(
        "",
      )}</fieldset><fieldset><legend>Notification preferences</legend><label class="check"><input type="checkbox" name="routineInHours" ${m.notifications?.routineInHours !== false ? "checked" : ""}>Routine updates during working hours</label><label class="check"><input type="checkbox" name="afterHours" ${m.notifications?.afterHours ? "checked" : ""}>Allow after-hours alerts</label></fieldset><fieldset><legend>On-call consent</legend><label class="check"><input type="checkbox" name="accepted" ${window.accepted ? "checked" : ""}>I accept this on-call window</label><p class="muted">Enter UTC dates and times: YYYY-MM-DD HH:MM.</p>${field("Starts (UTC)", "onCallStart", window.startsAt?.slice(0, 16).replace("T", " ") || "", 'placeholder="2026-11-08 12:00"')}${field("Ends (UTC)", "onCallEnd", window.endsAt?.slice(0, 16).replace("T", " ") || "", 'placeholder="2026-11-08 20:00"')}</fieldset>`,
    {
      id: "settings-form",
      subtitle: m.name,
      submit: "Save preferences",
      wide: true,
    },
  );
}
export function importSheet(kind) {
  const csv =
    "id,name,email,departmentId,title,team,timezone\nemployee-alex,Alex Morgan,alex@example.com,engineering,Software Engineer,Platform,America/Chicago";
  const catalog = JSON.stringify(
    [
      {
        metadata: {
          name: "training-queue",
          title: "Training queue",
          description: "Queues training jobs",
          annotations: { "tether.io/region": "global" },
        },
        spec: {
          type: "service",
          owner: "user:employee-noah",
          dependsOn: ["component:job-api"],
        },
      },
    ],
    null,
    2,
  );
  return sheet(
    kind === "people" ? "Import employee CSV" : "Import catalog JSON",
    `<p>Upload 1–150 records, review validation, then confirm.</p><details open><summary>Example format</summary><pre>${h(kind === "people" ? csv : catalog)}</pre><button type="button" data-download-example="${kind}">Download example</button></details><label class="field"><span>Choose ${kind === "people" ? "CSV" : "JSON"} file</span><input type="file" name="file" accept="${kind === "people" ? ".csv" : ".json"}" required></label><div id="import-preview"></div>`,
    { id: "import-form", subtitle: "Company setup", submit: "Preview import" },
  );
}
export const toolReviewLabels = {
  get_incident: {
    title: "Read the report",
    description: "Reviewed the reported issue and the selected systems.",
  },
  get_dependencies: {
    title: "Find connected systems",
    description: "Read the visible systems and their connections.",
  },
  analyze_incident_impact: {
    title: "Trace the possible impact",
    description:
      "Checked the recorded dependencies. Root cause still needs verification.",
  },
  simulate_containment: {
    title: "Preview a possible response",
    description: "Ran a simulation. No service was changed.",
  },
  list_fallback_plans: {
    title: "Review the safe restart path",
    description:
      "Read the plan for accepting the correct customer and denying the wrong customer.",
  },
  list_response_tasks: {
    title: "Review assigned work",
    description: "Read the existing tasks available to this reviewer.",
  },
  get_incident_timeline: {
    title: "Read team updates",
    description: "Read the recorded incident conversation.",
  },
};
export function completedCheckSteps(analysis) {
  return (analysis?.steps || [])
    .filter((s) =>
      [
        "observed",
        "completed",
        "success",
        "verified",
        "ok",
        "simulated",
      ].includes(s.status),
    )
    .map((s) => ({
      ...s,
      ...(toolReviewLabels[s.tool] || {
        title: "Review supporting evidence",
        description: "A scoped check returned a recorded result.",
      }),
    }));
}
export function analysisMarkup(a, incident = {}) {
  if (!a)
    return '<div class="empty compact"><b>Ready to trace the impact</b><p>Start analysis to check this incident’s connected systems.</p></div>';
  const reported = displayObservation(
    incident.observation || a.report?.observation || "",
  );
  const ownershipConcern =
    /(customer|tenant)/i.test(reported) &&
    /(restart|retry|retr)/i.test(reported);
  const plainHeadline = ownershipConcern
    ? "A customer may be able to restart someone else’s job"
    : a.report?.headline || "Reported issue ready for review";
  const r = a.report,
    known = toolReviewLabels,
    completed = completedCheckSteps(a);
  const findings = (a.steps || []).length
    ? (a.steps || []).map((step, index) => ({
        title:
          known[step.tool]?.title ||
          r?.findings?.[index]?.title ||
          "Review supporting evidence",
        status: step.status,
        detail:
          known[step.tool]?.description ||
          r?.findings?.[index]?.detail ||
          "No further recorded detail.",
      }))
    : r?.findings || [];
  return `<article class="analysis card"><div class="page-header"><div><span class="eyebrow">Reported concern · Needs verification</span><h2>${h(plainHeadline)}</h2></div><span class="pill ${a.mode === "live" ? "green" : "orange"}">${a.mode === "live" ? h(a.provider || "Live analysis") : a.mode === "scripted" ? "Rule-based plan" : "AI unavailable"}</span></div>${ownershipConcern ? '<div class="ownership-check"><span>Signed-in customer</span><b>→</b><span>Compare with job owner</span><b>→</b><span>Allow only a match</span></div><p class="plain-explanation">Check whether a restart request belongs to the signed-in customer. The reported issue is not confirmed by this analysis alone.</p>' : ""}<div class="visual-checks">${findings.map((s, i) => `<div class="visual-check"><span class="check-orb ${["observed", "completed", "success", "verified", "ok", "simulated"].includes(s.status) ? "checked" : ""}">${["observed", "completed", "success", "verified", "ok", "simulated"].includes(s.status) ? "✓" : i + 1}</span><b>${h(s.title || "Evidence check")}</b><small>${s.status === "simulated" ? "Scripted check" : h(human(s.status))}</small></div>`).join("")}</div>${completed.length && incident.id ? `<div class="replay-launch"><button class="primary" data-replay="${h(incident.id)}">▶ Replay ${completed.length} completed checks</button><small>A visual review of recorded results. No actions are executed.</small></div>` : ""}<div class="analysis-next"><span class="pill orange">Human review</span><p>Responders review the evidence. An authorized manager approves the exact action.</p></div><details><summary>Findings and next steps</summary><p>${h(displayObservation(r?.observation || a.summary || "No summary returned."))}</p>${findings.map((s) => `<p><b>${h(s.title)}</b><br>${h(s.detail || "No further detail returned.")}</p>`).join("")}${r?.nextSteps?.length ? `<h4>Next steps</h4><ol>${r.nextSteps.map((s) => `<li>${h(s)}</li>`).join("")}</ol>` : ""}${r?.unknowns?.length ? `<h4>Still to verify</h4><ul>${r.unknowns.map((s) => `<li>${h(s)}</li>`).join("")}</ul>` : ""}</details>${a.mode === "scripted" ? '<small class="analysis-disclosure">Rule-based evidence review. Live model inference was unavailable.</small>' : ""}${a.reason || r?.limitations?.length ? `<details><summary>Provider and limitations</summary>${a.reason ? `<p>${h(a.reason)}</p>` : ""}${(r?.limitations || []).map((s) => `<p>${h(s)}</p>`).join("")}</details>` : ""}</article>`;
}
export function nodeInspector(
  n,
  canEdit,
  edges = [],
  nodes = [],
  canIncident = false,
  canWorkspace = false,
) {
  const r = n.repository;
  return sheet(
    n.name,
    `<div class="button-row"><span class="pill">${h(human(n.kind))}</span><span class="pill ${n.safetyMode ? "orange" : (n.status || n.state) === "healthy" ? "green" : "orange"}">${h(n.safetyLabel || human(n.status || n.state || "healthy"))}</span></div>${n.safetyMode ? `<p class="safety-detail">${h(n.safetyDetail)}. This reports the verified response, not a source-code repair.</p>` : ""}<p>${h(n.description)}</p><div class="detail-block"><span class="eyebrow">Owner</span><h3>${h(n.ownerName || "Unassigned")}</h3></div><div class="button-row">${canEdit ? `<button class="primary" data-edit-node="${h(n.id)}">Edit node</button>` : ""}${canIncident ? `<button data-incident-node="${h(n.id)}">Create incident</button>` : ""}${canWorkspace ? `<button data-workspace-node="${h(n.id)}">Create workspace</button>` : ""}</div><h3>Repository reference</h3>${r ? `<div class="source-reference"><b>${h(r.path.split("/").pop())}</b><small>${h(r.path)}${r.lineStart ? ` · Lines ${r.lineStart}${r.lineEnd ? `–${r.lineEnd}` : ""}` : ""}</small><div class="button-row"><button data-source="${h(r.id)}">Preview source</button><button data-copy="${h(r.path)}">Copy path</button></div></div>` : '<p class="muted">No repository file mapped.</p>'}<h3>Connected systems</h3>${
      edges
        .filter((e) => e.sourceId === n.id || e.targetId === n.id)
        .map(
          (e) =>
            `<div class="relation-row"><div><b>${h(nodes.find((x) => x.id === (e.sourceId === n.id ? e.targetId : e.sourceId))?.name || "Connected node")}</b><small>${h(human(e.label || e.kind))}</small></div>${canEdit ? `<button data-edit-edge="${h(e.id)}">Edit</button>` : ""}</div>`,
        )
        .join("") || '<p class="muted">No connections yet.</p>'
    }${canEdit ? `<button class="danger-soft" data-delete-node="${h(n.id)}">Delete node</button>` : ""}`,
    { subtitle: "Node details" },
  );
}
export function peopleView(people, departments, editable) {
  return `<main class="page"><header class="page-header"><div><span class="eyebrow">Directory</span><h1>People <span class="count">${people.length}</span></h1></div>${editable ? '<button class="primary" data-add-person>Add person</button>' : ""}</header><div class="filter-bar"><label class="search-field">${icon("search")}<input id="people-search" type="search" placeholder="Search name, title or team"></label>${picker("Department", "peopleDepartment", departments, [], false, "All departments")}</div><section class="people-grid">${people.map((p) => `<article class="person-card" data-person-card data-search="${h(`${p.name} ${p.title} ${p.team}`.toLowerCase())}" data-department="${h(p.departmentId)}"><div class="person-top"><span class="avatar">${h(initials(p.name))}</span><span class="pill">${h(human(p.availability))}</span></div><h3>${h(p.name)}</h3><p>${h(p.title)}</p><small>${h(departments.find((d) => d.id === p.departmentId)?.name || p.team || "")}</small>${editable ? `<button data-edit-person="${h(p.id)}">Edit profile</button>` : ""}</article>`).join("")}</section><p id="people-empty" hidden>No people match your search.</p></main>`;
}
export function setupView(data) {
  return `<main class="page"><header class="page-header"><div><span class="eyebrow">Administration</span><h1>Company setup</h1></div></header><div class="setup-grid"><article class="card"><h2>Import company records</h2><p>Add employees or services. Review each import before saving.</p><div class="button-row"><button data-import="people">Employee CSV</button><button data-import="catalog">Catalog JSON</button></div></article><article class="card"><h2>Access templates</h2><p>Assign a template from each person's profile. Node and incident permissions still control what they can see.</p><button data-nav="people">Manage people</button><details><summary>View templates</summary>${(data.permissionTemplates || []).map((t) => `<p><b>${h(human(t.name))}</b><br>${h((t.capabilities || []).map((x) => human(x.replace(":", " "))).join(" · "))}</p>`).join("")}</details></article><article class="card span-two"><div class="page-header"><div><h2>Repository mappings</h2><p>Connect a node to a specific source file and revision.</p></div><button class="primary" data-add-repository>Add mapping</button></div>${(data.repositories || []).map((r) => `<div class="repo-row"><div><b>${h(data.nodes.find((n) => n.id === r.nodeId)?.name || "System source")}</b><small>${h(r.path)}${r.lineStart ? ` · Lines ${r.lineStart}${r.lineEnd ? `–${r.lineEnd}` : ""}` : ""}</small></div><div class="button-row"><button data-source="${h(r.id)}">Preview</button><button data-edit-repository="${h(r.id)}">Edit</button></div></div>`).join("") || '<p class="muted">No source mappings yet.</p>'}</article></div></main>`;
}
