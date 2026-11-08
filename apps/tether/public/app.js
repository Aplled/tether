import {
  api,
  auth,
  login,
  logout,
  action as requestAction,
  connectEvents,
} from "./api.js";
import { TetherCanvas } from "./canvas.js";
import { icon, tetherLogo } from "./icons.js";
import {
  escapeHtml as h,
  displayObservation,
  human,
  initials,
  field,
  textField,
  picker,
  sheet,
  nodeForm,
  personForm,
  incidentForm,
  workspaceForm,
  settingsForm,
  importSheet,
  validImportPreview,
  importPreviewMarkup,
  nodeInspector,
  peopleView,
  setupView,
  analysisMarkup,
  completedCheckSteps,
} from "./panels.js";
const app = document.querySelector("#app"),
  toastEl = document.querySelector("#toast");
const state = {
  data: null,
  tabs: [{ id: "map", kind: "map", name: "System map" }],
  active: "map",
  incidentTab: "overview",
  workspaceTab: "map",
  stream: "Connecting",
  selected: [],
  viewport: {},
  sheet: null,
  focus: null,
  labels: false,
  coverage: {},
  drafts: {},
  results: {},
  sidebar: false,
  replay: null,
};
let canvas, disconnect, canvasTabId, replayTimer;
const importPreviews = new WeakMap();
let liveRefreshTimer,
  liveRefreshPending = false,
  pointerActive = false;
let pendingActions = 0,
  snapshotSignature = "";
let sessionEpoch = 0,
  boundToken = auth.token();
const staleSessionError = () =>
  Object.assign(new Error("This session is no longer active."), {
    staleSession: true,
  });

// HTTP action responses and the live stream often carry the same snapshot.
// Accept current state once; a delayed stream record must not roll it backward.
function acceptSnapshot(next) {
  const data = next?.data || next?.state || next;
  const session = auth.get();
  if (
    !data ||
    !session?.token ||
    session.token !== boundToken ||
    data.user?.id !== session.user?.id
  )
    return false;
  if (
    data.user?.id === state.data?.user?.id &&
    Number(data.eventCursor) < Number(state.data?.eventCursor)
  )
    return false;
  const signature = JSON.stringify(data);
  if (signature === snapshotSignature) return false;
  state.data = data;
  snapshotSignature = signature;
  if (
    state.replay &&
    !state.data.analysisByIncident?.[state.replay.incidentId]
  ) {
    stopReplay();
    toast(
      "This review changed. Run analysis again to review the current evidence.",
    );
  }
  return true;
}
function scheduleLiveRefresh() {
  clearTimeout(liveRefreshTimer);
  if (liveRefreshPending) liveRefreshTimer = setTimeout(refreshLive, 120);
}
async function action(...args) {
  const epoch = sessionEpoch,
    token = auth.token();
  if (!token || token !== boundToken) throw staleSessionError();
  pendingActions++;
  try {
    const result = await requestAction(...args);
    if (epoch !== sessionEpoch || token !== auth.token())
      throw staleSessionError();
    if (result.state && acceptSnapshot(result.state)) liveRefreshPending = true;
    return result;
  } catch (error) {
    if (epoch !== sessionEpoch || token !== auth.token())
      throw staleSessionError();
    throw error;
  } finally {
    if (epoch === sessionEpoch) {
      pendingActions--;
      scheduleLiveRefresh();
    }
  }
}
// Never replace a target between pointer down and its click. Input focus and
// dirty forms are handled separately, so typing never moves the caret.
document.addEventListener(
  "pointerdown",
  () => {
    pointerActive = true;
  },
  true,
);
for (const event of ["pointerup", "pointercancel"]) {
  document.addEventListener(
    event,
    () => {
      pointerActive = false;
      scheduleLiveRefresh();
    },
    true,
  );
}
document.addEventListener("focusout", scheduleLiveRefresh, true);
window.addEventListener("blur", () => {
  pointerActive = false;
  scheduleLiveRefresh();
});
const explainError = (e) => {
  if (e.staleSession) return "";
  const message = String(e.message || "The request could not be completed.");
  if (
    e.status === 403 ||
    /forbidden|capability|permission denied|not authorized/i.test(message)
  )
    return "Your account does not have permission for this action. Ask your manager to update the assignment or access.";
  if (e.status === 409 || /revision.conflict|stale revision/i.test(message))
    return "This record changed in another session. Close and reopen the editor to use the latest version.";
  return human(message.replaceAll("_", " "));
};
const can = (...cs) =>
  cs.some((c) =>
    (state.data?.permissions || state.data?.capabilities || []).includes(c),
  ) || (state.data?.permissions || []).includes("*");
const items = (key) => state.data?.[key] || [];
const canEditNode = (n) =>
  Boolean(
    n &&
    (typeof n.canEdit === "boolean"
      ? n.canEdit
      : can("organization:admin") ||
        (can("graph:write") && n.ownerId === state.data?.user?.id)),
  );
const canEditEdge = (e) =>
  Boolean(e && canEditNode(items("nodes").find((n) => n.id === e.sourceId)));
const currentTab = () =>
  state.tabs.find((t) => t.id === state.active) || state.tabs[0];
const currentIncident = () =>
  items("incidents").find((i) => i.id === currentTab().targetId);
const currentWorkspace = () =>
  items("workspaces").find((w) => w.id === currentTab().targetId);
const commander = (i) =>
  i?.commanderId === state.data.user.id || can("incident:assign");
function safetyOverlay(nodeId) {
  const result = Object.values(state.data?.responseByIncident || {}).find(
    (r) =>
      r.safetyMode === "unsafe_route_disabled" &&
      r.affectedNodeIds?.includes(nodeId),
  );
  if (!result) return {};
  return {
    safetyMode: result.safetyMode,
    safetyLabel: "Unsafe restart blocked",
    safetyDetail:
      result.fallback?.verified === true &&
      result.fallback?.sameTenantAccepted === true &&
      result.fallback?.crossTenantDenied === true
        ? "Valid restarts verified"
        : "Valid restarts not yet verified",
  };
}
const restrictedCount = (i) =>
  Number(i?.restrictedNodeCount || i?.hiddenNodeCount || 0);
function scopeExplanation(i) {
  const count = restrictedCount(i);
  return count
    ? `<div class="scope-restricted"><b>${count} ${count === 1 ? "system is" : "systems are"} not shared with you</b><p>The incident manager can share read-only system access. Your tasks and conversation remain available.</p><button data-incident-tab="chat">Open incident conversation</button></div>`
    : !i.nodeIds?.length
      ? '<div class="scope-restricted"><b>System details are not shared with you</b><p>You can still join this incident’s tasks and conversation. Ask the incident manager to share the systems you need.</p><button data-incident-tab="chat">Open incident conversation</button></div>'
      : "";
}
const enrichNode = (n) => ({
  ...n,
  ownerName: items("members").find((m) => m.id === n.ownerId)?.name,
  department: items("departments").find(
    (d) =>
      d.id === items("members").find((m) => m.id === n.ownerId)?.departmentId,
  )?.name,
  repository: items("repositories").find((r) => r.nodeId === n.id),
  ...safetyOverlay(n.id),
});
const toast = (s, error = false) => {
  if (!s) return;
  toastEl.textContent = s;
  toastEl.className = `show ${error ? "error" : ""}`;
  clearTimeout(toastEl.timer);
  toastEl.timer = setTimeout(() => (toastEl.className = ""), 4200);
};
const localTime = (v) =>
  v
    ? new Date(v).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
const shortDate = (v) =>
  v
    ? new Date(v).toLocaleDateString([], { month: "short", day: "numeric" })
    : "";
const chosen = (f, n) => new FormData(f).getAll(n).filter(Boolean);
const values = (f) => Object.fromEntries(new FormData(f));
function sessionKey(name) {
  return `tether.${state.data?.user?.id || "guest"}.${name}`;
}
function persistTabs() {
  sessionStorage.setItem(
    sessionKey("tabs"),
    JSON.stringify({ tabs: state.tabs, active: state.active }),
  );
}
function restoreTabs() {
  try {
    const x = JSON.parse(sessionStorage.getItem(sessionKey("tabs")));
    if (x?.tabs?.length) {
      state.tabs = x.tabs;
      state.active = x.active;
    }
  } catch {}
  try {
    state.drafts =
      JSON.parse(sessionStorage.getItem(sessionKey("drafts"))) || {};
  } catch {}
}
function storeDraft(key, value) {
  state.drafts[key] = value;
  sessionStorage.setItem(sessionKey("drafts"), JSON.stringify(state.drafts));
}
function openTab(kind, targetId, name) {
  const id = targetId ? `${kind}:${targetId}` : kind;
  if (state.replay && kind !== "map") stopReplay();
  let t = state.tabs.find((x) => x.id === id);
  if (!t) {
    t = { id, kind, targetId, name };
    state.tabs.push(t);
  }
  if (state.active !== id) state.selected = [];
  if (kind === "workspace") state.focus = null;
  state.active = id;
  state.sidebar = false;
  closeOverlay();
  persistTabs();
  render();
}
function navigate(kind) {
  const labels = {
    map: "System map",
    people: "People",
    incidents: "Incidents",
    chat: "Company conversation",
    setup: "Company setup",
    settings: "My preferences",
  };
  openTab(kind, null, labels[kind] || kind);
}
function openIncident(id) {
  const i = items("incidents").find((x) => x.id === id);
  if (i) {
    if (currentTab().targetId !== id) state.incidentTab = "overview";
    openTab("incident", id, i.title);
  }
}
function openWorkspace(id) {
  const w = items("workspaces").find((x) => x.id === id);
  if (w) {
    if (currentTab().targetId !== id) state.workspaceTab = "map";
    openTab("workspace", id, w.name);
  }
}
function incidentListTitle() {
  return can("organization:admin") ? "Incidents" : "Your incidents";
}
function tabName(t) {
  if (t.kind === "incidents") return incidentListTitle();
  return t.kind === "incident"
    ? items("incidents").find((i) => i.id === t.targetId)?.title || t.name
    : t.kind === "workspace"
      ? items("workspaces").find((w) => w.id === t.targetId)?.name || t.name
      : t.name;
}
function resetSessionState() {
  sessionEpoch++;
  boundToken = auth.token();
  disconnect?.();
  disconnect = null;
  clearTimeout(liveRefreshTimer);
  clearTimeout(replayTimer);
  clearTimeout(toastEl.timer);
  liveRefreshPending = false;
  pointerActive = false;
  pendingActions = 0;
  snapshotSignature = "";
  state.replay = null;
  canvas?.dispose();
  canvas = null;
  canvasTabId = null;
  Object.assign(state, {
    data: null,
    tabs: [{ id: "map", kind: "map", name: "System map" }],
    active: "map",
    incidentTab: "overview",
    workspaceTab: "map",
    stream: "Connecting",
    selected: [],
    viewport: {},
    sheet: null,
    focus: null,
    labels: false,
    coverage: {},
    drafts: {},
    results: {},
    sidebar: false,
  });
  toastEl.textContent = "";
  toastEl.className = "";
}
function loginView(error = "") {
  canvas?.dispose();
  canvas = null;
  app.innerHTML = `<main class="login-shell"><section class="login-art"><div class="brand">${tetherLogo()}</div><div class="login-graphic"><span class="orb orb-one"></span><span class="orb orb-two"></span><span class="orb orb-three"></span><div class="login-node">${icon("canvas")}<b>Systems</b></div><div class="login-node">${icon("people")}<b>People</b></div><div class="login-node">${icon("incident")}<b>Response</b></div></div><p>Northstar Compute</p></section><form id="login-form" class="login-card"><span class="eyebrow">Tether</span><h1>Welcome back</h1><p>Sign in to your company workspace.</p>${field("Work email", "email", "", 'type="email" autocomplete="username" required')}${field("Password", "password", "", 'type="password" autocomplete="current-password" required')}<p class="form-error">${h(error)}</p><button class="primary wide" type="submit">Sign in</button><small>Each tab keeps its own signed-in session.</small></form></main>`;
  app.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.currentTarget,
      b = f.querySelector("button");
    b.disabled = true;
    const epoch = sessionEpoch;
    try {
      await login(f.email.value, f.password.value);
      if (epoch !== sessionEpoch) return;
      await load();
    } catch (e) {
      if (e.staleSession || !f.isConnected) return;
      f.querySelector(".form-error").textContent = e.message;
      b.disabled = false;
    }
  };
}
async function load() {
  const token = auth.token();
  if (!token) return loginView();
  if (token !== boundToken) resetSessionState();
  const epoch = sessionEpoch;
  const isCurrent = () => epoch === sessionEpoch && token === auth.token();
  try {
    const next = await api("/api/state");
    if (!isCurrent()) return;
    acceptSnapshot(next);
    const hadTabs = sessionStorage.getItem(sessionKey("tabs"));
    restoreTabs();
    if (!hadTabs && items("workspaces").length) {
      const w = items("workspaces")[0];
      state.tabs.push({
        id: `workspace:${w.id}`,
        kind: "workspace",
        targetId: w.id,
        name: w.name,
      });
      state.active = `workspace:${w.id}`;
      persistTabs();
    }
    render();
    disconnect?.();
    disconnect = connectEvents(
      (next) => {
        if (!isCurrent()) return;
        if (acceptSnapshot(next)) {
          liveRefreshPending = true;
          scheduleLiveRefresh();
        }
      },
      (status) => {
        if (!isCurrent()) return;
        state.stream = status;
        document
          .querySelector("#stream-state")
          ?.replaceChildren(status === "live" ? "Live" : human(status));
      },
    );
  } catch (e) {
    if (!isCurrent() || e.staleSession) return;
    if (e.status === 401) loginView("Your session expired. Sign in again.");
    else {
      app.innerHTML = `<main class="fatal"><h1>Could not open Tether</h1><p>${h(e.message)}</p><button id="retry">Try again</button></main>`;
      document.querySelector("#retry").onclick = load;
    }
  }
}
function refreshLive() {
  clearTimeout(liveRefreshTimer);
  if (!auth.get() || !liveRefreshPending || pointerActive || pendingActions)
    return;
  const deferredChrome = refreshChrome();
  const deferredFocus = refreshFocusSummary();
  if (state.sheet) return;
  if (document.querySelector('form[data-dirty="true"]')) return;
  const focused = document.activeElement;
  if (document.querySelector("[data-chat-list]")) {
    refreshMessages();
    liveRefreshPending = deferredChrome || deferredFocus;
    return;
  }
  if (
    focused?.matches("input,textarea,[contenteditable]") ||
    document.querySelector(".picker-popover:not([hidden])")
  )
    return;
  if (canvas) {
    canvas.setData(items("nodes").map(enrichNode), items("edges"));
    liveRefreshPending = deferredChrome || deferredFocus;
    return;
  }
  render();
}
function unreadNotices() {
  return items("notifications")
    .filter((n) => !n.read && !n.readAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
function noticeMarkup() {
  const notices = unreadNotices(),
    notice = notices[0];
  if (!notice) return "";
  return `<div class="notice-bar" role="status"><span>${h(notice.message || notice.text)}</span><div class="notice-actions">${notices.length > 1 ? `<small>${notices.length} unread</small>` : ""}<button data-read-notice="${h(notice.id)}" aria-label="${notices.length > 1 ? "Dismiss notice and show next" : "Dismiss notice"}">${notices.length > 1 ? "Dismiss · Next" : "×"}</button></div></div>`;
}
function refreshChrome() {
  // Update only live shell regions, retaining the canvas, editor, menus and draft.
  let deferred = false;
  const template = document.createElement("template");
  template.innerHTML = shell("");
  for (const selector of [
    "#notice-region",
    ".nav-count",
    "#workspace-list",
    "#incident-list",
  ]) {
    const current = document.querySelector(selector),
      next = template.content.querySelector(selector);
    if (!current || !next || current.innerHTML === next.innerHTML) continue;
    if (current.contains(document.activeElement)) {
      deferred = true;
      continue;
    }
    const scrollTop = current.scrollTop;
    current.innerHTML = next.innerHTML;
    current.scrollTop = scrollTop;
  }
  return deferred;
}
function shell(main) {
  const u = state.data.user,
    t = currentTab();
  return `<div class="app-shell ${state.sidebar ? "sidebar-open" : ""}"><aside class="sidebar"><a href="#" class="brand" data-nav="map">${tetherLogo()}</a><div class="company-name">${h(state.data.organization?.name || "Northstar Compute")}</div><nav class="primary-nav">${[
    ["map", "canvas", "System map"],
    ["people", "people", "People"],
    ["chat", "message", "Conversation"],
    ["incidents", "incident", incidentListTitle()],
  ]
    .map(
      ([k, i, label]) =>
        `<button data-nav="${k}" class="${t.kind === k ? "active" : ""}">${icon(i)}<span>${label}</span>${k === "incidents" ? `<b class="nav-count">${items("incidents").filter((i) => i.status !== "resolved").length}</b>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><section class="sidebar-section"><div class="sidebar-heading"><span>Workspaces</span>${can("organization:admin") ? '<button class="mini-button" data-create-workspace aria-label="Create workspace">+</button>' : ""}</div><div class="sidebar-list" id="workspace-list">${
    items("workspaces")
      .map(
        (w) =>
          `<button data-open-workspace="${h(w.id)}" class="${t.targetId === w.id ? "active" : ""}">${icon("canvas")}<span>${h(w.name)}</span></button>`,
      )
      .join("") || '<p class="sidebar-empty">No saved workspaces</p>'
  }</div>${can("organization:admin") ? '<button class="sidebar-create" data-create-workspace>+ Create workspace</button>' : ""}</section><section class="sidebar-section incidents-section"><div class="sidebar-heading"><span>${incidentListTitle()}</span></div><div class="sidebar-list" id="incident-list">${
    items("incidents")
      .slice()
      .reverse()
      .map(
        (i) =>
          `<button data-open-incident="${h(i.id)}" class="${t.targetId === i.id ? "active" : ""}"><i class="incident-dot ${i.status === "resolved" ? "resolved" : ""}"></i><span>${h(i.title)}</span></button>`,
      )
      .join("") ||
    `<p class="sidebar-empty">${can("organization:admin") ? "No incidents" : "No incidents shared with you"}</p>`
  }</div>${can("incident:create") ? '<button class="sidebar-create orange-text" data-create-incident>+ Create incident</button>' : ""}</section><footer class="sidebar-footer">${can("organization:admin") ? `<button data-nav="setup">${icon("settings")}<span>Company setup</span></button>` : ""}<button data-nav="settings"><span class="avatar">${h(initials(u.name))}</span><span><b>${h(u.name)}</b><small>My preferences</small></span></button></footer></aside><button class="sidebar-scrim" data-toggle-sidebar aria-label="Close navigation"></button><section class="main-shell"><header class="topbar"><div class="topbar-left"><button class="icon-button menu-toggle" data-toggle-sidebar aria-label="Open navigation">${icon("menu")}</button><span>${h(t.kind === "incident" ? "Incident response" : t.kind === "workspace" ? "Workspace" : t.kind === "map" ? "Company graph" : tabName(t))}</span></div><div class="topbar-actions"><span class="live-pill"><i></i><span id="stream-state">${state.stream === "live" ? "Live" : h(human(state.stream))}</span></span>${can("incident:create") ? '<button class="top-create" data-create-incident>+ Create incident</button>' : ""}</div></header><div class="tab-strip" role="tablist">${state.tabs.map((tab) => `<div class="workspace-tab ${tab.id === state.active ? "active" : ""}" role="presentation"><button role="tab" aria-selected="${tab.id === state.active}" data-tab="${h(tab.id)}" title="${h(tabName(tab))}">${icon(tab.kind === "incident" ? "incident" : tab.kind === "chat" ? "message" : tab.kind === "people" ? "people" : "canvas")}<span>${h(tabName(tab))}</span></button>${tab.id !== "map" ? `<button class="tab-close" aria-label="Close ${h(tabName(tab))}" data-close-tab="${h(tab.id)}">×</button>` : ""}</div>`).join("")}</div><div id="notice-region">${noticeMarkup()}</div><div id="view-host">${main}</div></section><div id="overlay"></div><div id="context-menu" hidden></div></div>`;
}
function replayMarkup() {
  const r = state.replay;
  if (!r) return "";
  const step = r.steps[r.index];
  return `<section class="evidence-replay ${r.playing ? "playing" : ""}" aria-label="Recorded evidence replay"><div class="replay-heading"><span class="eyebrow">Recorded checks · Visual replay</span><span class="pill">${r.playing ? "Reviewing" : r.index === r.steps.length - 1 ? "Last recorded check" : "Paused"} · ${r.index + 1} of ${r.steps.length}</span></div><div class="replay-current" aria-live="polite"><div class="replay-orb">${r.index + 1}</div><div><h2>${h(step.title)}</h2><p>${h(step.description)}</p></div><div class="replay-buttons"><button data-replay-previous ${r.index === 0 ? "disabled" : ""} aria-label="Previous recorded check">←</button><button class="primary" data-replay-toggle>${r.playing ? "Pause" : "Play"}</button><button data-replay-next ${r.index === r.steps.length - 1 ? "disabled" : ""} aria-label="Next recorded check">→</button><button data-replay-back="${h(r.incidentId)}">Back to incident</button></div></div><div class="replay-track">${r.steps.map((s, index) => `<button data-replay-index="${index}" class="${index === r.index ? "active" : index < r.index ? "reviewed" : ""}" aria-label="Review ${h(s.title)}"><span>${index < r.index ? "✓" : index + 1}</span><b>${h(s.title)}</b></button>`).join("")}</div><small class="replay-disclosure">Recorded evidence only. Highlighted systems are the scope of this check; replay does not change them.</small></section>`;
}
function stopReplay() {
  clearTimeout(replayTimer);
  state.replay = null;
  canvas?.setActivity(null);
  document.querySelector("#replay-panel")?.replaceChildren();
}
function paintReplay() {
  const r = state.replay;
  if (!r) return;
  const panel = document.querySelector("#replay-panel");
  if (panel) panel.innerHTML = replayMarkup();
  const step = r.steps[r.index];
  const graphChecks = [
    "get_incident",
    "get_dependencies",
    "analyze_incident_impact",
    "simulate_containment",
  ];
  let ids = graphChecks.includes(step.tool) ? r.nodeIds : [];
  ids = [...new Set(ids)].filter(
    (id) => r.nodeIds.includes(id) && items("nodes").some((n) => n.id === id),
  );
  canvas?.setActivity(ids.length ? { nodeIds: ids } : null);
  clearTimeout(replayTimer);
  if (r.playing) {
    replayTimer = setTimeout(() => {
      if (state.replay !== r) return;
      if (r.index < r.steps.length - 1) r.index++;
      else r.playing = false;
      paintReplay();
    }, 2300);
  }
}
function startReplay(incidentId) {
  const incident = items("incidents").find((i) => i.id === incidentId),
    analysis = state.data.analysisByIncident?.[incidentId],
    steps = completedCheckSteps(analysis);
  if (!incident || !steps.length) {
    toast("No completed checks are available to replay.");
    return;
  }
  clearTimeout(replayTimer);
  state.replay = {
    incidentId,
    steps,
    index: 0,
    playing: true,
    nodeIds: [...incident.nodeIds],
  };
  state.focus = incidentId;
  navigate("map");
  paintReplay();
}
function focusSummaryMarkup() {
  const incident = items("incidents").find((i) => i.id === state.focus);
  if (!incident) return "";
  const observed = state.data.responseByIncident?.[incident.id];
  const blocked =
    observed?.safetyMode === "unsafe_route_disabled" &&
    observed.affectedNodeIds?.some((id) => incident.nodeIds.includes(id));
  const restartsVerified =
    observed?.fallback?.verified === true &&
    observed.fallback.crossTenantDenied === true &&
    observed.fallback.sameTenantAccepted === true;
  const headline = blocked
    ? "Unsafe restart blocked"
    : restartsVerified
      ? "Restart checks passed"
      : incident.title;
  return `<section class="focus-summary ${blocked || restartsVerified ? "has-evidence" : ""}" aria-label="Incident map summary"><div><span class="eyebrow">${blocked || restartsVerified ? "Verified response" : "Incident focus"} · ${blocked || restartsVerified ? h(incident.title) : `${incident.nodeIds.length} systems`}</span><h2>${h(headline)}</h2>${restartsVerified ? "<p><strong>Valid restarts verified</strong> · Wrong customer denied. Correct customer accepted.</p>" : blocked ? "<p>The unsafe route is disabled. Valid restart checks are not yet verified.</p>" : ""}</div><button data-exit-focus>Show all systems</button></section>`;
}
function refreshFocusSummary() {
  const region = document.querySelector("#focus-summary");
  if (!region) return false;
  const markup = focusSummaryMarkup();
  if (region.innerHTML === markup) return false;
  if (region.contains(document.activeElement)) return true;
  region.innerHTML = markup;
  return false;
}
function mapView() {
  const w = currentTab().kind === "workspace" ? currentWorkspace() : null;
  return `<main class="canvas-page"><div class="canvas-toolbar"><div class="canvas-title"><h1>${h(w?.name || "System map")}</h1><span>${w ? `${w.nodeIds.length} ${w.nodeIds.length === 1 ? "node" : "nodes"}` : `${items("nodes").length} ${items("nodes").length === 1 ? "node" : "nodes"} · ${items("edges").length} ${items("edges").length === 1 ? "connection" : "connections"}`}</span></div><div class="toolbar-actions">${picker("View", "mapWorkspace", [{ id: "all", name: "All systems" }, ...items("workspaces")], w?.id || "all", false)}<button data-fit title="Fit visible nodes">${icon("fit")}<span>Fit</span></button>${can("graph:write") ? `${can("organization:admin") ? '<button data-organize title="Organize nodes">Arrange</button>' : ""}<button class="primary" data-add-node>${icon("plus")}<span>Add node</span></button>` : ""}</div></div>${w ? `<div class="view-tabs"><button class="active" data-workspace-tab="map">Map</button><button data-workspace-tab="chat">Conversation</button>${can("organization:admin") ? `<button data-edit-workspace="${h(w.id)}">Edit workspace</button>` : ""}</div>` : ""}<div id="focus-summary">${focusSummaryMarkup()}</div><div id="replay-panel">${replayMarkup()}</div><div class="canvas-stage"><section id="canvas" aria-label="System map"></section><div id="selection-toolbar" hidden></div><div class="canvas-controls"><button data-zoom="-1" aria-label="Zoom out">−</button><button data-fit aria-label="Fit canvas">${icon("fit")}</button><button data-zoom="1" aria-label="Zoom in">+</button><output id="canvas-zoom" aria-label="Canvas zoom">100%</output><label class="check"><input id="edge-labels" type="checkbox" ${state.labels ? "checked" : ""}>Edge labels</label></div><div class="gesture-hint">Scroll to pan · Shift + scroll to zoom · Drag to select</div></div></main>`;
}
function incidentsView() {
  return `<main class="page"><header class="page-header"><div><span class="eyebrow">Response</span><h1>${incidentListTitle()} <span class="count">${items("incidents").length}</span></h1></div>${can("incident:create") ? '<button class="primary" data-create-incident>Create incident</button>' : ""}</header><div class="incident-grid">${
    items("incidents")
      .slice()
      .reverse()
      .map(
        (i) =>
          `<button class="incident-card" data-open-incident="${h(i.id)}"><div class="button-row"><span class="pill priority-${h(i.priority || i.severity || "high")}">${h(human(i.priority || i.severity || "high"))} priority</span><span class="pill">${h(human(i.status))}</span></div><h2>${h(i.title)}</h2><p>${h(displayObservation(i.observation))}</p><footer><span>${i.memberIds?.length || 0} responders · ${i.nodeIds?.length || 0} nodes</span><b>Open incident →</b></footer></button>`,
      )
      .join("") ||
    (can("organization:admin")
      ? '<div class="empty"><h2>No incidents</h2><p>Create an incident when there is an observation to investigate.</p></div>'
      : '<div class="empty"><h2>No incidents shared with you</h2><p>Company notices appear above. Incident details appear here when they are shared with you.</p></div>')
  }</div></main>`;
}
function incidentView() {
  const i = currentIncident();
  if (!i)
    return '<main class="page"><h1>Incident unavailable</h1><button data-nav="incidents">Back to incidents</button></main>';
  const tab = state.incidentTab,
    tasks = items("tasks").filter((t) => t.incidentId === i.id),
    p = state.data.proposalsByIncident?.[i.id],
    a = state.data.analysisByIncident?.[i.id];
  return `<main class="incident-page"><header class="incident-header"><button class="back-button" data-nav="incidents">← ${can("organization:admin") ? "All incidents" : "Your incidents"}</button><div class="page-header"><div><div class="button-row"><span class="pill priority-${h(i.priority || i.severity || "high")}">${h(human(i.priority || i.severity || "high"))} priority</span><span class="pill">${h(human(i.status))}</span></div><h1>${h(i.title)}</h1><p>${i.memberIds?.length || 0} responders · ${i.nodeIds?.length || 0} visible systems${restrictedCount(i) ? ` · ${restrictedCount(i)} not shared` : ""}</p></div>${i.nodeIds?.length ? `<button data-focus-incident="${h(i.id)}">${icon("canvas")} View on map</button>` : ""}</div></header><nav class="view-tabs" aria-label="Incident sections">${[
    ["overview", "Overview"],
    ["tasks", `Tasks (${tasks.length})`],
    ["chat", "Conversation"],
    ["actions", "Actions"],
  ]
    .map(
      ([id, name]) =>
        `<button class="${tab === id ? "active" : ""}" data-incident-tab="${id}">${name}</button>`,
    )
    .join(
      "",
    )}</nav><div class="incident-body ${tab === "chat" ? "chat-body" : ""}">${tab === "overview" ? incidentOverview(i, a) : tab === "tasks" ? tasksView(i, tasks) : tab === "chat" ? chatView("incident", i.id) : responseView(i, p)}</div></main>`;
}
function incidentSystemFlow(i) {
  const nodes = items("nodes").filter((n) => i.nodeIds.includes(n.id)),
    edges = items("edges").filter(
      (e) => i.nodeIds.includes(e.sourceId) && i.nodeIds.includes(e.targetId),
    );
  return `<section class="incident-systems"><div class="page-header"><div><span class="eyebrow">Systems under review</span><h2>${nodes.length ? `${nodes.length} systems to review` : "System scope"}</h2></div>${nodes.length ? `<button data-focus-incident="${h(i.id)}">Open map →</button>` : ""}</div>${scopeExplanation(i)}<div class="incident-system-grid">${nodes
    .map((n) => {
      const m = items("members").find((m) => m.id === n.ownerId);
      const safety = safetyOverlay(n.id);
      return `<button class="incident-system-card ${safety.safetyMode ? "safety-restricted" : ""}" data-inspect="${h(n.id)}"><span class="system-symbol">${icon(n.kind === "person" ? "people" : "canvas")}</span><b>${h(n.name)}</b><span class="system-owner"><span class="avatar">${h(initials(m?.name || "?"))}</span>${h(m?.name || "Unassigned")}</span>${safety.safetyMode ? `<span class="safety-label">${h(safety.safetyLabel)}</span><small>${h(safety.safetyDetail)}</small>` : ""}</button>`;
    })
    .join(
      "",
    )}</div>${edges.length ? `<details><summary>${edges.length} ${edges.length === 1 ? "connection" : "connections"} in this scope</summary>${edges.map((e) => `<p>${h(nodes.find((n) => n.id === e.sourceId)?.name)} → ${h(nodes.find((n) => n.id === e.targetId)?.name)} <small>${h(human(e.label || e.kind))}</small></p>`).join("")}</details>` : ""}</section>`;
}
function incidentOverview(i, a) {
  return `<div class="overview-grid"><section class="overview-main"><article class="card observation"><span class="eyebrow">Initial observation</span><p>${h(displayObservation(i.observation) || "No observation recorded.")}</p><div class="button-row">${i.nodeIds?.length ? `<button class="primary" data-analyze="${h(i.id)}">Analyze affected path</button>` : ""}${commander(i) ? `<button data-coverage="${h(i.id)}">Check coverage</button>` : ""}</div></article>${incidentSystemFlow(i)}${analysisMarkup(a, i)}${state.coverage[i.id] ? `<article class="card"><h3>Responder coverage</h3><p>${state.coverage[i.id].approvalBlocked ? "No eligible approver is available. Risky actions remain blocked." : "An eligible responder is available."}</p>${(state.coverage[i.id].candidates || []).map((c) => `<div class="relation-row"><b>${h(items("members").find((m) => m.id === c.memberId)?.name || "Responder")}</b><span>${c.eligible ? "Available" : h((c.reasons || []).map(human).join(", "))}</span></div>`).join("")}</article>` : ""}</section><aside class="overview-side"><article class="card"><div class="page-header"><h3>Responders and scope</h3>${commander(i) ? "<button data-edit-incident-scope>Edit</button>" : ""}</div>${(
    i.memberIds || []
  )
    .map((id) => items("members").find((m) => m.id === id))
    .filter(Boolean)
    .map(
      (m) =>
        `<div class="responder-row"><span class="avatar">${h(initials(m.name))}</span><div><b>${h(m.name)}</b><small>${h(m.title)}</small></div></div>`,
    )
    .join("")}<h4>Affected nodes</h4>${(i.nodeIds || [])
    .map((id) => items("nodes").find((n) => n.id === id))
    .filter(Boolean)
    .map(
      (n) =>
        `<button class="node-link" data-inspect="${h(n.id)}">${icon("canvas")} ${h(n.name)}</button>`,
    )
    .join(
      "",
    )}</article>${commander(i) ? `<article class="card"><h3>Incident priority</h3><form id="priority-form">${picker("Priority", "priority", ["low", "medium", "high", "critical"], i.priority || i.severity || "high")}<button type="submit">Save priority</button><p class="form-error"></p></form></article>` : ""}</aside></div>`;
}
function tasksView(i, tasks) {
  const done = tasks.filter((t) => t.status === "done").length;
  const followups = i.status === "resolved" && done < tasks.length;
  const resolutionVerified =
    state.data.responseByIncident?.[i.id]?.resolution?.verified === true;
  return `${followups ? `<div class="task-followup-note"><b>${resolutionVerified ? "Immediate issue verified resolved" : "Incident resolved"}</b><span>${tasks.length - done} follow-up ${tasks.length - done === 1 ? "task remains" : "tasks remain"} open. Assignees still need to complete this work.</span></div>` : ""}<div class="task-progress"><span><b>${done}</b> / ${tasks.length} tasks completed</span><div class="progress-track"><i style="width:${tasks.length ? (done / tasks.length) * 100 : 0}%"></i></div></div><div class="tasks-header"><div><h2>Response tasks</h2><p>Assignments and coding-agent prompts for this incident.</p></div>${commander(i) ? '<button class="primary" data-add-task>Create task</button>' : ""}</div><div class="task-grid">${tasks.map((t) => `<article class="card task-card"><span class="pill">${h(t.status === "investigating" ? "In progress" : human(t.status))}</span><h3>${h(t.title)}</h3><p>Assigned to <b>${h(items("members").find((m) => m.id === t.ownerId)?.name || "Unassigned")}</b></p><small class="assignee-status">${h(human(items("members").find((m) => m.id === t.ownerId)?.availability || "Availability unknown"))}</small><div class="button-row">${t.ownerId === state.data.user.id || commander(i) ? `<button class="primary" data-brief="${h(t.id)}">Agent prompt</button><button data-edit-task="${h(t.id)}">Edit task</button>` : ""}</div></article>`).join("") || '<div class="empty"><h3>No tasks assigned yet</h3><p>Create a task for a responder to begin.</p></div>'}</div>`;
}
function responseProof(observed) {
  const containment = observed?.containment,
    fallback = observed?.fallback,
    resolution = observed?.resolution;
  const checks = [
    {
      title: "Unsafe route blocked",
      passed: containment?.checks?.find(
        (c) => c.label === "Retry endpoint disabled",
      )?.passed,
    },
    { title: "Wrong customer denied", passed: fallback?.crossTenantDenied },
    {
      title: "Valid requests still work",
      passed: fallback?.sameTenantAccepted,
    },
    { title: "Resolution verified", passed: resolution?.verified },
  ];
  return `<div class="proof-grid">${checks.map((c) => `<article class="proof-card ${c.passed === true ? "passed" : c.passed === false ? "failed" : ""}"><span class="proof-icon">${c.passed === true ? "✓" : c.passed === false ? "!" : "○"}</span><div><b>${c.title}</b><small>${c.passed === true ? "Verified by the server" : c.passed === false ? "Check did not pass" : "Not yet verified"}</small></div></article>`).join("")}</div>`;
}
function responseView(i, p) {
  if (i.allowedAutomaticAction === null && !p)
    return `<div class="card"><span class="eyebrow">Response options</span><h2>Use assigned tasks for these systems</h2><p>No automatic action is configured for this incident’s systems. Coordinate the next step with the assigned responders.</p><div class="button-row"><button data-incident-tab="tasks">Open tasks</button><button data-incident-tab="chat">Open conversation</button></div></div>`;
  const authz = commander(i);
  const names = {
    awaiting_approval: "Ready for review",
    verified: "Unsafe restart blocked",
    failed: "Verification failed",
    stale_target: "The response target restarted",
    stale_context: "Incident context changed",
    executed: "Action executed; verification pending",
  };
  const result = state.results[i.id],
    observed = state.data.responseByIncident?.[i.id];
  return `${responseProof(observed)}<div class="response-layout"><article class="card"><span class="eyebrow">Controlled response</span><h2>Block unsafe job restarts</h2><p>Disable the affected restart route, then check that the protected path accepts the right customer and rejects everyone else.</p>${p ? `<div class="response-status"><span class="pill ${p.status === "verified" ? "green" : "orange"}">${h(names[p.status] || human(p.status))}</span><h3>Target</h3><p>Isolated job restart service</p>${p.status === "awaiting_approval" && authz ? `<button class="primary" data-approve="${h(p.id)}" data-digest="${h(p.digest)}">Approve and block unsafe restarts</button>` : ["stale_target", "stale_context"].includes(p.status) && authz ? `<p>The previous approval is no longer valid. Prepare a fresh action using current evidence.</p><button data-prepare="${h(i.id)}">Prepare current response</button>` : ""}<details><summary>Technical action details</summary><dl><dt>Operation</dt><dd>${h(human(p.operation || p.action))}</dd><dt>Target</dt><dd>${h(typeof p.target === "object" ? p.target.identity || p.target.serviceId || "Isolated response target" : p.target)}</dd><dt>Approval digest</dt><dd><code>${h(p.digest)}</code></dd></dl></details></div>` : authz ? `<button class="primary" data-prepare="${h(i.id)}">Review proposed block</button>` : "<p>The incident commander can prepare and approve this action.</p>"}${p?.status === "verified" && authz ? `<div class="response-next"><h3>Check who can restart a job</h3><div class="button-row"><button data-fallback="${h(i.id)}">Check safe job restarts</button><button data-resolve="${h(i.id)}">Verify resolution</button></div></div>` : ""}${result ? `<div class="recommendation"><h3>${h(result.title)}</h3><p>${h(result.message)}</p>${result.details ? `<details><summary>Verification details</summary><pre>${h(JSON.stringify(result.details, null, 2))}</pre></details>` : ""}</div>` : ""}</article><article class="card"><h3>Approval boundaries</h3><p>Approval applies to this exact operation and target. A changed target or changed incident requires a new review.</p><p>The source code is not claimed repaired. These checks verify blocked unsafe requests and the protected restart path.</p></article></div>`;
}
function chatView(scope, id) {
  const isIncident = scope === "incident",
    w =
      scope === "workspace"
        ? items("workspaces").find((w) => w.id === id)
        : null,
    key = `${scope}:${id || "company"}`;
  return `<section class="conversation ${isIncident ? "incident-conversation" : ""}">${!isIncident ? `<header class="conversation-header">${w ? '<button class="back-button" data-workspace-tab="map">← Workspace map</button>' : ""}<span class="eyebrow">${w ? "Workspace conversation" : "Company channel"}</span><h1>${h(w?.name || "Conversation")}</h1><p>${w ? "Updates shared with workspace members." : "Everyday updates for your company."}</p></header>` : ""}<div class="message-list" data-chat-list data-scope="${scope}" data-target="${h(id || "")}"></div><form id="message-form" class="message-composer" data-scope="${scope}" data-target="${h(id || "")}" data-draft-key="${h(key)}"><label class="sr-only" for="message-text">Message</label><textarea id="message-text" name="text" required maxlength="4000" placeholder="Write a message…">${h(state.drafts[key] || "")}</textarea><div class="composer-footer"><small>Messages stay within this ${isIncident ? "incident" : w ? "workspace" : "company"}.</small><button class="primary" type="submit">Send message ${icon("message")}</button></div><p class="form-error"></p></form></section>`;
}
function refreshMessages() {
  const el = document.querySelector("[data-chat-list]");
  if (!el) return;
  const scope = el.dataset.scope,
    id = el.dataset.target;
  const messages =
    scope === "incident"
      ? items("messages").filter((m) => m.incidentId === id)
      : items("conversations").filter(
          (m) =>
            m.scope === scope &&
            (scope !== "workspace" || m.workspaceId === id),
        );
  const sig = messages.map((m) => m.id).join(",");
  if (el.dataset.signature === sig) return;
  const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  el.innerHTML =
    messages
      .map((m) => {
        const author = items("members").find((x) => x.id === m.authorId);
        return `<article class="message ${m.authorId === state.data.user.id ? "mine" : ""}"><span class="avatar">${h(initials(author?.name || "Member"))}</span><div class="message-content"><header><b>${h(author?.name || "Company member")}</b><time title="${h(new Date(m.createdAt).toLocaleString())}">${h(shortDate(m.createdAt))} · ${h(localTime(m.createdAt))}</time></header><p>${h(m.text)}</p></div></article>`;
      })
      .join("") ||
    '<div class="empty"><h3>Start the conversation</h3><p>Share an update, ask a question, or add evidence.</p></div>';
  el.dataset.signature = sig;
  if (bottom || !el.dataset.loaded) el.scrollTop = el.scrollHeight;
  el.dataset.loaded = "true";
}
function render() {
  const session = auth.get();
  if (
    !session?.token ||
    session.token !== boundToken ||
    state.data?.user?.id !== session.user?.id
  )
    return;
  clearTimeout(liveRefreshTimer);
  liveRefreshPending = false;
  const t = currentTab();
  if (canvas) {
    state.viewport[canvasTabId || state.active] = {
      ...(canvas.beforeFocusViewport || canvas.viewport),
    };
    canvas.dispose();
    canvas = null;
  }
  let main =
    t.kind === "map" || (t.kind === "workspace" && state.workspaceTab === "map")
      ? mapView()
      : t.kind === "workspace"
        ? chatView("workspace", t.targetId)
        : t.kind === "incident"
          ? incidentView()
          : t.kind === "incidents"
            ? incidentsView()
            : t.kind === "people"
              ? peopleView(
                  items("members"),
                  items("departments"),
                  can("directory:write"),
                )
              : t.kind === "setup"
                ? setupView(state.data)
                : t.kind === "chat"
                  ? chatView("company")
                  : t.kind === "settings"
                    ? `<main class="page settings-page"><header class="page-header"><div><span class="eyebrow">Account</span><h1>My preferences</h1></div><button data-logout>Sign out</button></header>${settingsForm(items("members").find((m) => m.id === state.data.user.id) || state.data.user)}</main>`
                    : mapView();
  app.innerHTML = shell(main);
  document
    .querySelector(".workspace-tab.active")
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  bindPickers(app);
  bindForms(app);
  if (document.querySelector("#canvas")) mountCanvas();
  refreshMessages();
}
function bindPickers(root) {
  root.querySelectorAll("[data-picker]").forEach((p) => {
    const trigger = p.querySelector(".picker-trigger"),
      popover = p.querySelector(".picker-popover"),
      search = p.querySelector(".picker-search"),
      multiple = p.dataset.multiple === "true";
    const update = () => {
      const selected = [...p.querySelectorAll(".picker-option.selected")];
      p.querySelector(".picker-values").innerHTML = selected
        .map(
          (o) =>
            `<input type="hidden" name="${h(p.dataset.name)}" value="${h(o.dataset.value)}">`,
        )
        .join("");
      p.querySelector("[data-picker-label]").textContent = selected.length
        ? multiple
          ? `${selected.length} selected`
          : selected[0].dataset.label
        : "Choose…";
      p.querySelectorAll(".picker-option").forEach((o) => {
        const on = o.classList.contains("selected");
        o.setAttribute(multiple ? "aria-checked" : "aria-selected", String(on));
        o.querySelector(".option-check").textContent = on ? "✓" : "";
      });
      p.dispatchEvent(
        new CustomEvent("pickerchange", {
          bubbles: true,
          detail: {
            name: p.dataset.name,
            values: selected.map((o) => o.dataset.value),
          },
        }),
      );
    };
    trigger.onclick = () => {
      const open = popover.hidden;
      document
        .querySelectorAll(".picker-popover")
        .forEach((x) => (x.hidden = true));
      document
        .querySelectorAll(".picker-trigger")
        .forEach((x) => x.setAttribute("aria-expanded", "false"));
      popover.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) search.focus();
    };
    search.oninput = () => {
      const q = search.value.toLowerCase();
      let count = 0;
      p.querySelectorAll(".picker-option").forEach((o) => {
        o.hidden = !o.dataset.search.includes(q);
        if (!o.hidden) count++;
      });
      p.querySelector(".picker-empty").hidden = count > 0;
    };
    p.querySelectorAll(".picker-option").forEach(
      (o) =>
        (o.onclick = () => {
          if (!multiple)
            p.querySelectorAll(".picker-option").forEach((x) =>
              x.classList.remove("selected"),
            );
          o.classList.toggle("selected");
          update();
          if (!multiple) {
            popover.hidden = true;
            trigger.setAttribute("aria-expanded", "false");
            trigger.focus();
          }
        }),
    );
    p.querySelector("[data-select-all]")?.addEventListener("click", () => {
      p.querySelectorAll(".picker-option:not([hidden])").forEach((o) =>
        o.classList.add("selected"),
      );
      update();
    });
    p.querySelector("[data-clear-selection]").onclick = () => {
      p.querySelectorAll(".picker-option").forEach((o) =>
        o.classList.remove("selected"),
      );
      update();
    };
  });
}
function showOverlay(html, kind = "form") {
  state.sheet = kind;
  document.querySelector("#overlay").innerHTML =
    `<div class="scrim" data-close></div>${html}`;
  document.querySelector("#overlay").classList.add("open");
  bindPickers(document.querySelector("#overlay"));
  bindForms(document.querySelector("#overlay"));
  requestAnimationFrame(() =>
    document
      .querySelector("#overlay input:not([type=hidden]),#overlay textarea")
      ?.focus(),
  );
}
function closeOverlay() {
  state.sheet = null;
  const o = document.querySelector("#overlay");
  if (o) {
    o.innerHTML = "";
    o.classList.remove("open");
  }
}
function showNode(id) {
  const n = items("nodes").find((n) => n.id === id);
  if (n)
    showOverlay(
      nodeInspector(
        enrichNode(n),
        canEditNode(n),
        items("edges"),
        items("nodes"),
        can("incident:create"),
        can("organization:admin"),
      ),
      "node:" + id,
    );
}
function newIncident(ids = []) {
  showOverlay(
    incidentForm(
      items("nodes"),
      items("members"),
      items("regions"),
      ids,
      can("organization:admin"),
    ),
  );
}
function editWorkspace(w = {}, ids = []) {
  showOverlay(workspaceForm(state.data, w, ids));
}
function editNode(n = {}) {
  if (!n.id && !can("organization:admin"))
    n = { ...n, ownerId: state.data.user.id };
  if (n.id && !canEditNode(n)) {
    showNode(n.id);
    return;
  }
  showOverlay(
    nodeForm(
      n,
      can("organization:admin")
        ? items("members")
        : items("members").filter((m) => m.id === state.data.user.id),
      items("regions"),
      can("organization:admin"),
    ),
  );
}
function taskForm(t = {}) {
  const i = currentIncident(),
    members = items("members").filter((m) => i.memberIds.includes(m.id));
  showOverlay(
    sheet(
      t.id ? "Edit task" : "Create task",
      `<input type="hidden" name="id" value="${h(t.id || "")}">${field("Task title", "title", t.title, `required maxlength="300" ${commander(i) ? "" : "readonly"}`)}${commander(i) ? picker("Assigned responder", "ownerId", members, t.ownerId || members[0]?.id) : `<input type="hidden" name="ownerId" value="${h(t.ownerId)}">`}${
        t.id
          ? picker(
              "Status",
              "status",
              [
                { id: "assigned", name: "Assigned" },
                { id: "acknowledged", name: "Acknowledged" },
                { id: "investigating", name: "In progress" },
                { id: "blocked", name: "Blocked" },
                { id: "done", name: "Done" },
              ],
              t.status,
            )
          : picker(
              "Scoped nodes",
              "nodeIds",
              items("nodes").filter((n) => i.nodeIds.includes(n.id)),
              [],
              true,
            )
      }`,
      {
        id: "task-form",
        subtitle: i.title,
        submit: t.id ? "Save task" : "Create task",
      },
    ),
  );
}
function editIncidentScope() {
  const i = currentIncident();
  showOverlay(
    sheet(
      "Edit responders and scope",
      `${picker(
        "Responders",
        "memberIds",
        items("members").map((m) => ({ ...m, detail: m.title })),
        i.memberIds,
        true,
      )}${picker(
        "Affected or suspected nodes",
        "nodeIds",
        items("nodes").map((n) => ({ ...n, detail: n.description })),
        i.nodeIds,
        true,
      )}${can("organization:admin") ? '<label class="check share-consent"><input type="checkbox" name="shareSystems" checked><span><b>Share selected systems with responders</b><small>Add read-only access for this incident. Existing permissions stay unchanged.</small></span></label>' : ""}`,
      { id: "incident-scope-form", subtitle: i.title, submit: "Save scope" },
    ),
  );
}
function repositoryForm(r = {}) {
  showOverlay(
    sheet(
      r.id ? "Edit repository mapping" : "Add repository mapping",
      `<input type="hidden" name="id" value="${h(r.id || "")}">${picker("Node", "nodeId", items("nodes"), r.nodeId)}${field("Repository", "repository", "local:hackutd", "readonly")}${field("Pinned revision", "revision", r.revision || "WORKTREE", 'required placeholder="WORKTREE or commit SHA"')}${field("File path", "path", r.path, 'required placeholder="apps/tether/server.ts"')}<div class="field-grid">${field("Start line", "lineStart", r.lineStart || "", 'type="number" min="1"')}${field("End line", "lineEnd", r.lineEnd || "", 'type="number" min="1"')}</div><p class="muted">Only permitted files in the configured repository can be previewed.</p>`,
      {
        id: "repository-form",
        subtitle: "Company setup",
        submit: "Save mapping",
      },
    ),
  );
}
function edgeForm(e) {
  if (!canEditEdge(e)) {
    toast("Only an owner of the source system can change this connection.");
    return;
  }
  showOverlay(
    sheet(
      "Edit connection",
      `<input type="hidden" name="id" value="${h(e.id)}"><p>${h(items("nodes").find((n) => n.id === e.sourceId)?.name)} → ${h(items("nodes").find((n) => n.id === e.targetId)?.name)}</p>${field("Label", "label", e.label, 'required maxlength="80"')}${picker("Relationship", "kind", ["depends_on", "owns", "supports", "feeds", "routes_to", "part_of"], e.kind)}<button type="button" class="danger-soft" data-delete-edge="${h(e.id)}">Delete connection</button>`,
      { id: "edge-form", subtitle: "System map", submit: "Save connection" },
    ),
  );
}
function selectionToolbar() {
  const el = document.querySelector("#selection-toolbar");
  if (!el) return;
  const ids = state.selected.filter((id) =>
    items("nodes").some((n) => n.id === id),
  );
  el.hidden = !ids.length;
  if (!ids.length) return;
  el.innerHTML = `<b>${ids.length === 1 ? h(items("nodes").find((n) => n.id === ids[0])?.name) : `${ids.length} nodes selected`}</b><div class="button-row">${ids.length === 1 ? `<button data-inspect="${h(ids[0])}">Details</button>${canEditNode(items("nodes").find((n) => n.id === ids[0])) ? `<button data-edit-node="${h(ids[0])}">Edit</button>` : ""}` : ""}${can("incident:create") ? '<button class="orange-button" data-selection-incident>Create incident</button>' : ""}${can("organization:admin") ? "<button data-selection-workspace>Create workspace</button>" : ""}<button class="icon-button" data-clear-canvas aria-label="Clear selection">×</button></div>`;
}
function mountCanvas() {
  canvasTabId = state.active;
  const w = currentTab().kind === "workspace" ? currentWorkspace() : null;
  const restoredViewport = state.viewport[state.active];
  if (w) state.selected = state.selected.filter((id) => w.nodeIds.includes(id));
  canvas = new TetherCanvas(document.querySelector("#canvas"), {
    canEdit: can("graph:write"),
    canEditNode,
    onSelect: (n) => {
      state.selected = n ? [n.id] : [];
      selectionToolbar();
    },
    onSelectionChange: (ids) => {
      state.selected = ids;
      selectionToolbar();
    },
    onEditNode: editNode,
    onInspect: (n) => showNode(n.id),
    onEditEdge: edgeForm,
    onContextMenu: contextMenu,
    onConnect: async (sourceId, targetId, kind = "depends_on") => {
      try {
        await mutate(
          "edge.create",
          { sourceId, targetId, kind, label: human(kind) },
          { message: "Connection created", render: false },
        );
        canvas?.setData(items("nodes").map(enrichNode), items("edges"));
      } catch (error) {
        toast(explainError(error), true);
      }
    },
    onMove: (id, x, y) => {
      const n = items("nodes").find((n) => n.id === id);
      action("node.move", { id, x, y, layoutRevision: n?.layoutRevision })
        .then((r) => {
          if (r.state) acceptSnapshot(r.state);
        })
        .catch((e) => toast(explainError(e), true));
    },
    onLayout: async (positions) => {
      try {
        for (const pos of positions) {
          const n = items("nodes").find((n) => n.id === pos.id);
          const r = await action("node.move", {
            ...pos,
            layoutRevision: n?.layoutRevision,
          });
          if (r.state) acceptSnapshot(r.state);
        }
      } catch (error) {
        toast(explainError(error), true);
      }
    },
    onDeleteNodes: deleteNodes,
    onDeleteEdge: (id) =>
      deleteEdge(id).catch((error) => toast(explainError(error), true)),
    onViewportChange: (v) => {
      if (canvas?.filter?.focusIds == null)
        state.viewport[canvasTabId || state.active] = { ...v };
      document
        .querySelector("#canvas-zoom")
        ?.replaceChildren(`${Math.round(v.zoom * 100)}%`);
    },
  });
  if (state.viewport[state.active])
    canvas.viewport = { ...state.viewport[state.active] };
  canvas.setData(items("nodes").map(enrichNode), items("edges"));
  canvas.setFilter?.(w ? { workspaceId: w.id, nodeIds: w.nodeIds } : {});
  canvas.setFocus?.(
    state.focus
      ? items("incidents").find((i) => i.id === state.focus)?.nodeIds
      : null,
  );
  canvas.setEdgeLabels?.(state.labels);
  canvas.setSelection(state.selected);
  const mountedCanvas = canvas;
  requestAnimationFrame(() => {
    if (canvas !== mountedCanvas) return;
    canvas.initializeView({ viewport: restoredViewport, minZoom: 0.65 });
  });
  if (state.focus && state.data.analysisByIncident?.[state.focus])
    canvas.setActivity?.({
      nodeIds:
        items("incidents").find((i) => i.id === state.focus)?.nodeIds || [],
    });
  document
    .querySelector("#canvas-zoom")
    ?.replaceChildren(`${Math.round(canvas.viewport.zoom * 100)}%`);
  if (state.replay) paintReplay();
  selectionToolbar();
}
function contextMenu(c) {
  const el = document.querySelector("#context-menu");
  if (!el) return;
  const n = c.node,
    e = c.edge,
    ids = n
      ? c.selection?.includes(n.id)
        ? c.selection
        : [n.id]
      : c.selection || [];
  state.selected = ids;
  selectionToolbar();
  el.innerHTML =
    c.kind === "node"
      ? `<b>${h(n.name)}</b><button data-inspect="${h(n.id)}">View details</button>${canEditNode(n) ? `<button data-edit-node="${h(n.id)}">Edit node</button><button data-connect-node="${h(n.id)}">Connect to another node</button>` : ""}${can("incident:create") ? "<button data-selection-incident>Create incident</button>" : `<button data-report-node="${h(n.id)}">Ask manager to open incident</button>`}${can("organization:admin") ? "<button data-selection-workspace>Create workspace</button>" : ""}${canEditNode(n) ? `<button class="danger-text" data-delete-node="${h(n.id)}">Delete node</button>` : ""}`
      : c.kind === "edge"
        ? `<b>Connection</b>${canEditEdge(e) ? `<button data-edit-edge="${h(e.id)}">Edit connection</button><button class="danger-text" data-delete-edge="${h(e.id)}">Delete connection</button>` : "<p>Read-only connection</p>"}`
        : `${can("graph:write") ? "<button data-add-node>Add node</button>" : ""}${can("incident:create") ? "<button data-create-incident>Create incident</button>" : ""}${can("organization:admin") ? "<button data-create-workspace>Create workspace</button>" : ""}<button data-fit>Fit map</button>`;
  el.hidden = false;
  el.style.left = `${Math.min(c.x, window.innerWidth - 235)}px`;
  el.style.top = `${Math.min(c.y, window.innerHeight - el.offsetHeight - 15)}px`;
}
async function mutate(
  type,
  payload,
  { message, render: rerender = true, idempotent = false } = {},
) {
  const r = await action(
    type,
    payload,
    idempotent ? { idempotencyKey: crypto.randomUUID() } : {},
  );
  if (r.state) acceptSnapshot(r.state);
  if (message) toast(message);
  if (rerender) render();
  return r;
}
async function deleteNodes(ids) {
  showOverlay(
    sheet(
      `Delete ${ids.length === 1 ? "node" : "nodes"}?`,
      `<p>This removes ${ids.length === 1 ? h(items("nodes").find((n) => n.id === ids[0])?.name) : `${ids.length} nodes`} and its connections from the company graph.</p><div class="button-row"><button data-close>Cancel</button><button class="danger-button" id="confirm-delete">Delete ${ids.length === 1 ? "node" : "nodes"}</button></div>`,
    ),
  );
  document.querySelector("#confirm-delete").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      for (const id of ids) {
        const n = items("nodes").find((n) => n.id === id);
        await mutate(
          "node.delete",
          { id, semanticRevision: n?.semanticRevision },
          { render: false },
        );
      }
      state.selected = [];
      closeOverlay();
      render();
      toast("Node removed");
    } catch (e) {
      toast(explainError(e), true);
    }
  };
}
async function deleteEdge(id) {
  const e = items("edges").find((x) => x.id === id);
  await mutate("edge.delete", { id, revision: e?.revision }, { render: false });
  closeOverlay();
  render();
  toast("Connection removed");
}
function bindForms(root) {
  root.querySelectorAll("form").forEach((f) => {
    if (f.getAttribute("id") === "login-form") return;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const button = f.querySelector("[type=submit]");
      if (f.getAttribute("id") === "import-form" && button.disabled) return;
      button.disabled = true;
      f.querySelector(".form-error")?.replaceChildren();
      try {
        await submitForm(f);
      } catch (e) {
        const error = f.querySelector(".form-error");
        if (error) error.textContent = explainError(e);
        else toast(explainError(e), true);
      } finally {
        const preview = importPreviews.get(f)?.preview;
        button.disabled = Boolean(preview && !validImportPreview(preview));
      }
    };
  });
  root
    .querySelector("#message-text")
    ?.addEventListener("input", (e) =>
      storeDraft(e.target.form.dataset.draftKey, e.target.value),
    );
  root.querySelector("#people-search")?.addEventListener("input", filterPeople);
  root.querySelector("#edge-labels")?.addEventListener("change", (e) => {
    state.labels = e.target.checked;
    canvas?.setEdgeLabels?.(state.labels);
  });
  root
    .querySelector("#import-form input[type=file]")
    ?.addEventListener("change", () => {
      const f = root.querySelector("#import-form");
      resetImportPreview(f);
    });
}
function resetImportPreview(form) {
  importPreviews.delete(form);
  delete form.dataset.previewId;
  const button = form.querySelector("[type=submit]");
  button.textContent = "Preview import";
  button.disabled = false;
  form.querySelector("#import-preview").innerHTML = "";
  form.querySelector(".form-error")?.replaceChildren();
}
function filterPeople() {
  const q = document.querySelector("#people-search")?.value.toLowerCase() || "",
    d = document.querySelector("[name=peopleDepartment]")?.value;
  let count = 0;
  document.querySelectorAll("[data-person-card]").forEach((el) => {
    el.hidden =
      !el.dataset.search.includes(q) || !!(d && el.dataset.department !== d);
    if (!el.hidden) count++;
  });
  const empty = document.querySelector("#people-empty");
  if (empty) empty.hidden = count > 0;
}
app.addEventListener("input", (e) => {
  const form = e.target.closest("form");
  if (form && form.getAttribute("id") !== "message-form")
    form.dataset.dirty = "true";
});
app.addEventListener("change", (e) => {
  const form = e.target.closest("form");
  if (form && form.getAttribute("id") !== "message-form")
    form.dataset.dirty = "true";
});
app.addEventListener("pickerchange", (e) => {
  const form = e.target.closest("form");
  if (form) form.dataset.dirty = "true";
  if (e.detail.name === "peopleDepartment") filterPeople();
  if (e.detail.name === "mapWorkspace") {
    const id = e.detail.values[0];
    if (id && id !== "all") openWorkspace(id);
    else navigate("map");
  }
});
async function submitForm(f) {
  const v = values(f);
  if (f.getAttribute("id") === "node-form") {
    const n = items("nodes").find((n) => n.id === v.id),
      patch = {
        name: v.name,
        description: v.description,
        kind: v.kind || "service",
        ownerId: v.ownerId || null,
        regionId: v.regionId || null,
      };
    if (!v.regionId) throw Error("Choose a region.");
    const saved = await mutate(
      v.id ? "node.update" : "node.create",
      v.id
        ? { id: v.id, semanticRevision: n.semanticRevision, patch }
        : {
            ...patch,
            ownerId: v.ownerId || undefined,
            criticality: "medium",
            x: 220,
            y: 180,
          },
      { render: false },
    );
    const nodeId = v.id || saved.result?.id || saved.result?.node?.id;
    const workspace =
      currentTab().kind === "workspace" ? currentWorkspace() : null;
    if (!v.id && nodeId && workspace && can("organization:admin")) {
      await mutate(
        "workspace.update",
        {
          id: workspace.id,
          revision: workspace.revision,
          patch: { nodeIds: [...new Set([...workspace.nodeIds, nodeId])] },
        },
        { render: false },
      );
    }
    closeOverlay();
    if (!v.id) {
      stopReplay();
      state.focus = null;
    }
    if (nodeId) state.selected = [nodeId];
    if (!v.id && workspace && !can("organization:admin")) navigate("map");
    else render();
    if (!v.id && nodeId) {
      canvas?.revealNode(nodeId);
      selectionToolbar();
    }
    toast(v.id ? "Node saved" : "Node created");
  } else if (f.getAttribute("id") === "person-form") {
    if (!v.departmentId) throw Error("Choose a department.");
    const p = items("members").find((m) => m.id === v.id);
    await mutate(
      v.id ? "member.update" : "member.create",
      v.id
        ? {
            id: v.id,
            revision: p.revision,
            patch: {
              name: v.name,
              title: v.title,
              departmentId: v.departmentId,
              team: v.team,
              ...(v.roleTemplate ? { roleTemplate: v.roleTemplate } : {}),
            },
          }
        : {
            ...v,
            jobFamily: v.title,
            level: "Individual contributor",
            timezone: "America/Chicago",
          },
      { render: false },
    );
    closeOverlay();
    render();
    toast("Profile saved");
  } else if (f.getAttribute("id") === "incident-form") {
    const nodeIds = chosen(f, "nodeIds");
    if (chosen(f, "memberIds").length > 30)
      throw Error("Choose up to 30 responders for one incident.");
    if (nodeIds.length > 50) throw Error("Choose up to 50 affected nodes.");
    if (!nodeIds.length) throw Error("Choose at least one affected node.");
    const r = await mutate(
      "incident.create",
      {
        title: v.title,
        observation: v.observation,
        regionId: v.regionId || "global",
        nodeIds,
        memberIds: chosen(f, "memberIds"),
        priority: v.severity || "high",
      },
      { render: false, idempotent: true },
    );
    const id =
      r.result?.id || r.result?.incident?.id || items("incidents").at(-1)?.id;
    let shareError = null;
    if (id && v.shareSystems && can("organization:admin")) {
      try {
        await mutate(
          "incident.share_systems",
          { incidentId: id, memberIds: chosen(f, "memberIds"), nodeIds },
          { render: false },
        );
      } catch (error) {
        if (error.staleSession) throw error;
        shareError = error;
      }
    }
    closeOverlay();
    if (id) openIncident(id);
    else render();
    toast(
      shareError
        ? "Incident created. System sharing could not be saved; edit the incident scope to retry."
        : v.shareSystems
          ? "Incident created and selected systems shared"
          : "Incident created",
      Boolean(shareError),
    );
  } else if (f.getAttribute("id") === "saved-workspace-form") {
    const w = items("workspaces").find((w) => w.id === v.id),
      patch = {
        name: v.name,
        nodeIds: chosen(f, "nodeIds"),
        memberIds: chosen(f, "memberIds"),
      };
    if (!patch.nodeIds.length)
      throw Error("Choose at least one node for this workspace.");
    const r = await mutate(
      v.id ? "workspace.update" : "workspace.create",
      v.id ? { id: v.id, revision: w.revision, patch } : patch,
      { render: false },
    );
    closeOverlay();
    const id =
      v.id ||
      r.result?.id ||
      r.result?.workspace?.id ||
      items("workspaces").at(-1)?.id;
    openWorkspace(id);
    toast("Workspace saved");
  } else if (f.getAttribute("id") === "incident-scope-form") {
    const i = currentIncident();
    if (chosen(f, "memberIds").length > 30)
      throw Error("Choose up to 30 responders.");
    if (!chosen(f, "nodeIds").length)
      throw Error("Choose at least one affected node.");
    await mutate(
      "incident.update",
      {
        id: i.id,
        revision: i.revision,
        patch: {
          memberIds: chosen(f, "memberIds"),
          nodeIds: chosen(f, "nodeIds"),
        },
      },
      { render: false },
    );
    let shareError = null;
    if (v.shareSystems && can("organization:admin")) {
      try {
        await mutate(
          "incident.share_systems",
          {
            incidentId: i.id,
            memberIds: chosen(f, "memberIds"),
            nodeIds: chosen(f, "nodeIds"),
          },
          { render: false },
        );
      } catch (error) {
        if (error.staleSession) throw error;
        shareError = error;
      }
    }
    closeOverlay();
    render();
    toast(
      shareError
        ? "Scope saved. System sharing could not be saved; reopen scope to retry."
        : v.shareSystems
          ? "Scope saved and selected systems shared"
          : "Responders and scope saved",
      Boolean(shareError),
    );
  } else if (f.getAttribute("id") === "priority-form") {
    const i = currentIncident();
    await mutate(
      "incident.update",
      { id: i.id, revision: i.revision, patch: { priority: v.priority } },
      { message: "Priority saved" },
    );
  } else if (f.getAttribute("id") === "task-form") {
    const i = currentIncident(),
      t = items("tasks").find((t) => t.id === v.id);
    if (!v.ownerId) throw Error("Choose an assignee.");
    await mutate(
      v.id ? "task.update" : "task.create",
      v.id
        ? {
            id: v.id,
            revision: t.revision,
            status: v.status,
            ...(commander(i) ? { title: v.title, ownerId: v.ownerId } : {}),
          }
        : {
            incidentId: i.id,
            title: v.title,
            ownerId: v.ownerId,
            nodeIds: chosen(f, "nodeIds"),
          },
      { render: false },
    );
    closeOverlay();
    render();
    toast("Task saved");
  } else if (f.getAttribute("id") === "message-form") {
    const scope = f.dataset.scope,
      id = f.dataset.target,
      key = f.dataset.draftKey;
    await mutate(
      scope === "incident" ? "message.send" : "conversation.send",
      scope === "incident"
        ? { incidentId: id, text: v.text }
        : {
            scope,
            ...(scope === "workspace" ? { workspaceId: id } : {}),
            text: v.text,
          },
      { render: false, idempotent: true },
    );
    storeDraft(key, "");
    f.elements.text.value = "";
    refreshMessages();
    f.elements.text.focus();
    const list = document.querySelector("[data-chat-list]");
    list.scrollTop = list.scrollHeight;
  } else if (f.getAttribute("id") === "settings-form") {
    const m = items("members").find((m) => m.id === state.data.user.id),
      workingHours = [];
    for (let i = 0; i < 7; i++)
      if (v[`day${i}`])
        workingHours.push({
          weekday: i,
          start: v[`start${i}`],
          end: v[`end${i}`],
        });
    let onCallWindows = [];
    if (v.accepted) {
      const startsAt = new Date(
          `${v.onCallStart.trim().replace(" ", "T")}:00Z`,
        ),
        endsAt = new Date(`${v.onCallEnd.trim().replace(" ", "T")}:00Z`);
      if (
        !Number.isFinite(+startsAt) ||
        !Number.isFinite(+endsAt) ||
        endsAt <= startsAt
      )
        throw Error(
          "Enter valid on-call dates; the end must be after the start.",
        );
      onCallWindows = [
        {
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          accepted: true,
        },
      ];
    }
    await mutate(
      "settings.update",
      {
        timezone: v.timezone,
        availability: v.availability || m.availabilitySetting || m.availability,
        workingHours,
        notifications: {
          routineInHours: !!v.routineInHours,
          afterHours: !!v.afterHours,
          channels: m.notifications?.channels || ["in_app"],
          severities: m.notifications?.severities || ["high", "critical"],
        },
        onCallWindows,
      },
      { message: "Preferences saved" },
    );
  } else if (f.getAttribute("id") === "repository-form") {
    if (!v.nodeId) throw Error("Choose a node.");
    const old = items("repositories").find((r) => r.id === v.id);
    await mutate(
      "repository.save",
      {
        ...(v.id ? { id: v.id, revisionNumber: old?.revisionNumber } : {}),
        nodeId: v.nodeId,
        repository: "local:hackutd",
        revision: v.revision,
        path: v.path,
        ...(v.lineStart ? { lineStart: Number(v.lineStart) } : {}),
        ...(v.lineEnd ? { lineEnd: Number(v.lineEnd) } : {}),
      },
      { render: false },
    );
    closeOverlay();
    render();
    toast("Repository mapping saved");
  } else if (f.getAttribute("id") === "edge-form") {
    const edge = items("edges").find((e) => e.id === v.id);
    await mutate(
      "edge.update",
      {
        id: v.id,
        revision: edge.revision,
        patch: { kind: v.kind, label: v.label },
      },
      { render: false },
    );
    closeOverlay();
    render();
    toast("Connection saved");
  } else if (f.getAttribute("id") === "import-form") {
    const file = f.elements.file.files[0];
    if (!file) throw Error("Choose a file.");
    if (file.size > 128 * 1024)
      throw Error("Choose a file of 128 KiB or less.");
    const review = importPreviews.get(f);
    if (!review) {
      const semanticRevision = state.data.organization.semanticRevision;
      const r = await action("import.preview", {
        format:
          state.importKind === "people" ? "employees_csv" : "catalog_json",
        content: await file.text(),
      });
      if (!f.isConnected || f.elements.file.files[0] !== file) return;
      const preview = r.result;
      importPreviews.set(f, { preview, file, semanticRevision });
      f.dataset.previewId = preview.previewId || "";
      f.querySelector("#import-preview").innerHTML = importPreviewMarkup(
        preview,
        items("departments"),
        items(preview.format === "employees_csv" ? "members" : "nodes"),
      );
      f.querySelector("[type=submit]").textContent = "Confirm import";
      f.querySelector("[data-reset-import-preview]").onclick = () =>
        resetImportPreview(f);
      if (!validImportPreview(preview))
        throw Error("Fix the listed errors and choose the corrected file.");
    } else {
      // A disabled button is not the validation boundary: refuse an invalid or
      // replaced preview even if submission is triggered directly.
      if (review.file !== file)
        throw Error(
          "The selected file changed. Preview it again before confirming.",
        );
      if (!validImportPreview(review.preview))
        throw Error(
          "This preview has errors. Correct the file and preview it again.",
        );
      await mutate(
        "import.commit",
        {
          previewId: review.preview.previewId,
          semanticRevision: review.semanticRevision,
        },
        { render: false },
      );
      importPreviews.delete(f);
      closeOverlay();
      render();
      toast("Import saved");
    }
  }
}
async function showSource(id) {
  const origin = state.sheet;
  const source = await api(`/api/source?id=${encodeURIComponent(id)}`);
  const lineStart = source.lineStart || 1,
    lineEnd = source.lineEnd || source.text.split("\n").length;
  const vscode = source.vscodeUrl || source.vscodeUri || source.editorUrl;
  showOverlay(
    sheet(
      source.path.split("/").pop(),
      `<button class="back-button" id="source-back">← Back ${origin?.startsWith("node:") ? "to node" : "to setup"}</button><div class="source-reference"><b>${h(source.path)}</b><p>Lines ${lineStart}–${lineEnd} · ${source.revision === "WORKTREE" ? "Working tree" : "Pinned revision"}</p><div class="button-row"><button data-copy="${h(source.path)}">Copy path</button>${typeof vscode === "string" && vscode.startsWith("vscode://file/") ? `<a class="button" href="${h(vscode)}">Open in VS Code</a>` : ""}</div></div><pre class="source-code">${h(
        source.text
          .split("\n")
          .map((l, i) => `${String(i + 1).padStart(4, " ")}  ${l}`)
          .join("\n"),
      )}</pre><details><summary>Revision details</summary><code>${h(source.revision)}</code></details>`,
      { subtitle: "Source preview", wide: true },
    ),
    "source",
  );
  document.querySelector("#source-back").onclick = () =>
    origin?.startsWith("node:") ? showNode(origin.slice(5)) : closeOverlay();
}
async function showBrief(id) {
  const r = await action("brief.generate", { taskId: id });
  if (r.state) acceptSnapshot(r.state);
  const brief = r.result,
    prompt = typeof brief.text === "string" ? brief.text : "";
  const copyShortcut = /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘C"
    : "Ctrl+C";
  showOverlay(
    sheet(
      "Agent prompt",
      `<button class="back-button" data-close>← Back to tasks</button><p>Review this scoped prompt, then copy it to your coding agent.</p><div class="button-row"><button type="button" class="primary" id="copy-brief" ${prompt ? "" : "disabled"}>${icon("copy")} Copy prompt</button><button type="button" id="select-brief" ${prompt ? "" : "disabled"}>Select prompt text</button></div><p id="brief-copy-status" class="copy-status" role="status">If browser copy is unavailable, select the text and press ${copyShortcut}.</p><label class="sr-only" for="agent-prompt-text">Agent prompt text</label><textarea id="agent-prompt-text" class="agent-prompt-editor" readonly spellcheck="false" aria-label="Agent prompt text">${h(prompt || "No prompt returned.")}</textarea><details><summary>Prompt provenance</summary><p>Incident snapshot revision ${h(brief.snapshotRevision)}</p><code>${h(brief.id)}</code></details>`,
      {
        subtitle:
          items("tasks").find((t) => t.id === id)?.title || "Task handoff",
        wide: true,
      },
    ),
    "brief",
  );
  const textarea = document.querySelector("#agent-prompt-text"),
    status = document.querySelector("#brief-copy-status");
  const selectPrompt = () => {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    status.textContent = `All prompt text selected. Press ${copyShortcut}, then paste into your editor.`;
  };
  document.querySelector("#select-brief").onclick = selectPrompt;
  textarea.addEventListener("copy", (event) => {
    const selected = textarea.value.slice(
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    if (!selected) return;
    if (event.clipboardData) {
      event.clipboardData.setData("text/plain", selected);
      event.preventDefault();
    }
    status.textContent =
      "Keyboard copy requested. Paste into your editor to confirm.";
    action("brief.copy", { id: brief.id }).catch(() => {
      status.textContent =
        "Keyboard copy requested. The export log could not be updated.";
    });
  });
  document.querySelector("#copy-brief").onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (!navigator.clipboard?.writeText)
        throw Error("Browser clipboard is unavailable.");
      await navigator.clipboard.writeText(prompt);
      let verified = false;
      try {
        const permission = await navigator.permissions?.query({
          name: "clipboard-read",
        });
        if (permission?.state === "granted" && navigator.clipboard.readText)
          verified = (await navigator.clipboard.readText()) === prompt;
      } catch {}
      if (verified) {
        status.textContent =
          "Prompt copied and verified. Paste it into your coding agent.";
        toast("Agent prompt copied");
      } else {
        selectPrompt();
        status.textContent = `The browser accepted the copy request, but its clipboard could not be verified. The full prompt is selected; press ${copyShortcut} if paste is empty.`;
      }
      try {
        await action("brief.copy", { id: brief.id });
      } catch {
        status.textContent += " The export log could not be updated.";
      }
    } catch {
      selectPrompt();
      status.textContent = `Browser copy is unavailable. The full prompt is selected; press ${copyShortcut}, then paste into your editor.`;
    } finally {
      button.disabled = false;
    }
  };
}
function downloadExample(kind) {
  const csv =
    "id,name,email,departmentId,title,team,timezone\nemployee-alex,Alex Morgan,alex@example.com,engineering,Software Engineer,Platform,America/Chicago\n";
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
  const blob = new Blob([kind === "people" ? csv : catalog], {
      type: kind === "people" ? "text/csv" : "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download =
    kind === "people" ? "employee-example.csv" : "catalog-example.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function runResponse(kind, id, digest) {
  const incident = currentIncident();
  const r = await mutate(
    `response.${kind}`,
    kind === "approve" ? { proposalId: id, digest } : { incidentId: id },
    { render: false },
  );
  const result = r.result,
    verified = result?.verified === true || result?.state === "verified";
  if (kind !== "prepare") {
    state.results[incident.id] = {
      title:
        kind === "approve"
          ? "Containment result"
          : kind === "fallback"
            ? "Safe restart checks"
            : "Resolution verification",
      message: verified
        ? kind === "approve"
          ? "The unsafe restart route is blocked. The independent observer confirmed the change."
          : kind === "fallback"
            ? "The wrong customer was denied. The correct customer was accepted by the protected restart path."
            : "The server verified that the incident can be resolved."
        : result?.verified === false || result?.state === "failed"
          ? "The verification did not pass. Review the evidence before proceeding."
          : "The operation returned without a verified success result.",
      details: result,
    };
  }
  state.incidentTab = "actions";
  render();
}
app.addEventListener("click", async (e) => {
  const b = e.target.closest("button,a[data-nav]");
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (!b.closest("[data-picker]")) {
    document
      .querySelectorAll(".picker-popover")
      .forEach((p) => (p.hidden = true));
    document
      .querySelectorAll(".picker-trigger")
      .forEach((p) => p.setAttribute("aria-expanded", "false"));
  }
  if (!b.closest("#context-menu")) {
    const m = document.querySelector("#context-menu");
    if (m) m.hidden = true;
  } else document.querySelector("#context-menu").hidden = true;
  try {
    if (d.nav) {
      e.preventDefault();
      navigate(d.nav);
    } else if (d.tab) {
      if (state.replay && d.tab !== "map") stopReplay();
      if (state.active !== d.tab) state.selected = [];
      if (state.tabs.find((t) => t.id === d.tab)?.kind === "workspace")
        state.focus = null;
      state.active = d.tab;
      state.sidebar = false;
      closeOverlay();
      persistTabs();
      render();
    } else if (d.closeTab) {
      const index = state.tabs.findIndex((t) => t.id === d.closeTab);
      state.tabs = state.tabs.filter((t) => t.id !== d.closeTab);
      if (state.active === d.closeTab)
        state.active = state.tabs[Math.max(0, index - 1)]?.id || "map";
      persistTabs();
      render();
    } else if ("toggleSidebar" in d) {
      state.sidebar = !state.sidebar;
      document
        .querySelector(".app-shell")
        .classList.toggle("sidebar-open", state.sidebar);
    } else if ("close" in d) closeOverlay();
    else if ("logout" in d) {
      const request = logout();
      resetSessionState();
      const epoch = sessionEpoch;
      loginView();
      try {
        await request;
      } catch (error) {
        if (epoch === sessionEpoch && !auth.token())
          toast(
            "Signed out on this tab. The server could not confirm session revocation.",
            true,
          );
      }
    } else if ("createIncident" in d) newIncident();
    else if ("selectionIncident" in d) newIncident(state.selected);
    else if (d.incidentNode) newIncident([d.incidentNode]);
    else if (d.reportNode) {
      const n = items("nodes").find((n) => n.id === d.reportNode);
      storeDraft(
        "company:company",
        `Please review ${n?.name || "this system"} and open an incident if needed. Observed issue: `,
      );
      navigate("chat");
    } else if ("createWorkspace" in d) editWorkspace();
    else if ("selectionWorkspace" in d) editWorkspace({}, state.selected);
    else if (d.workspaceNode) editWorkspace({}, [d.workspaceNode]);
    else if (d.editWorkspace)
      editWorkspace(items("workspaces").find((w) => w.id === d.editWorkspace));
    else if (d.openWorkspace) openWorkspace(d.openWorkspace);
    else if (d.deleteWorkspace) {
      const w = items("workspaces").find((w) => w.id === d.deleteWorkspace);
      showOverlay(
        sheet(
          "Delete workspace?",
          `<p>Remove ${h(w.name)} from the workspace list? The company nodes remain available on the system map.</p><div class="button-row"><button data-close>Cancel</button><button class="danger-button" id="delete-workspace-confirm">Delete workspace</button></div>`,
        ),
      );
      document.querySelector("#delete-workspace-confirm").onclick = async (
        e,
      ) => {
        e.currentTarget.disabled = true;
        try {
          await mutate(
            "workspace.delete",
            { id: w.id, revision: w.revision },
            { render: false },
          );
          state.tabs = state.tabs.filter((t) => t.targetId !== w.id);
          state.active = "map";
          persistTabs();
          closeOverlay();
          render();
          toast("Workspace deleted");
        } catch (error) {
          toast(explainError(error), true);
        }
      };
    } else if (d.personActive) {
      const p = items("members").find((m) => m.id === d.personActive);
      if (p.id === state.data.user.id)
        throw Error("Ask another administrator to change your account status.");
      await mutate(
        "member.update",
        {
          id: p.id,
          revision: p.revision,
          patch: { active: d.active === "true" },
        },
        { render: false },
      );
      closeOverlay();
      render();
      toast(
        d.active === "true" ? "Profile reactivated" : "Profile deactivated",
      );
    } else if (d.openIncident) openIncident(d.openIncident);
    else if (d.incidentTab) {
      state.incidentTab = d.incidentTab;
      render();
    } else if (d.workspaceTab) {
      state.workspaceTab = d.workspaceTab;
      render();
    } else if ("addNode" in d) editNode();
    else if (d.editNode)
      editNode(items("nodes").find((n) => n.id === d.editNode));
    else if (d.inspect) showNode(d.inspect);
    else if (d.deleteNode) await deleteNodes([d.deleteNode]);
    else if (d.editEdge)
      edgeForm(items("edges").find((x) => x.id === d.editEdge));
    else if (d.deleteEdge) await deleteEdge(d.deleteEdge);
    else if (d.connectNode) {
      closeOverlay();
      canvas?.beginConnect(d.connectNode);
      toast("Choose the destination node");
    } else if ("clearCanvas" in d) {
      canvas?.clearSelection();
      state.selected = [];
      selectionToolbar();
    } else if ("fit" in d) canvas?.fit();
    else if (d.zoom) canvas?.zoomBy(d.zoom === "1" ? 1.2 : 1 / 1.2);
    else if ("organize" in d) {
      b.disabled = true;
      const w = currentTab().kind === "workspace" ? currentWorkspace() : null;
      await mutate("graph.organize", w ? { nodeIds: w.nodeIds } : {}, {
        render: false,
      });
      canvas?.setData(items("nodes").map(enrichNode), items("edges"));
      if (w) canvas?.fit();
      else if (canvas) canvas.zoomBy(Math.max(1, 0.65 / canvas.viewport.zoom));
      toast("Map organized by department and dependency");
    } else if (d.replay) {
      startReplay(d.replay);
    } else if ("replayToggle" in d) {
      if (state.replay) {
        if (
          !state.replay.playing &&
          state.replay.index === state.replay.steps.length - 1
        )
          state.replay.index = 0;
        state.replay.playing = !state.replay.playing;
        paintReplay();
      }
    } else if ("replayNext" in d) {
      if (state.replay) {
        state.replay.playing = false;
        state.replay.index = Math.min(
          state.replay.index + 1,
          state.replay.steps.length - 1,
        );
        paintReplay();
      }
    } else if ("replayPrevious" in d) {
      if (state.replay) {
        state.replay.playing = false;
        state.replay.index = Math.max(0, state.replay.index - 1);
        paintReplay();
      }
    } else if ("replayIndex" in d) {
      if (state.replay) {
        state.replay.playing = false;
        state.replay.index = Number(d.replayIndex);
        paintReplay();
      }
    } else if (d.replayBack) {
      const id = d.replayBack;
      stopReplay();
      openIncident(id);
    } else if (d.focusIncident) {
      state.focus = d.focusIncident;
      navigate("map");
      canvas?.setFocus(
        items("incidents").find((i) => i.id === d.focusIncident)?.nodeIds,
      );
    } else if ("exitFocus" in d) {
      stopReplay();
      state.focus = null;
      canvas?.setFocus(null);
      render();
    } else if ("addPerson" in d)
      showOverlay(
        personForm({}, items("departments"), can("organization:admin")),
      );
    else if (d.editPerson)
      showOverlay(
        personForm(
          items("members").find((p) => p.id === d.editPerson),
          items("departments"),
          can("organization:admin"),
        ),
      );
    else if ("addRepository" in d) repositoryForm();
    else if (d.editRepository)
      repositoryForm(
        items("repositories").find((r) => r.id === d.editRepository),
      );
    else if (d.source) {
      b.disabled = true;
      await showSource(d.source);
    } else if ("copy" in d) {
      await navigator.clipboard.writeText(d.copy);
      toast("Copied");
    } else if (d.import) {
      state.importKind = d.import;
      showOverlay(importSheet(d.import));
    } else if (d.downloadExample) downloadExample(d.downloadExample);
    else if ("editIncidentScope" in d) editIncidentScope();
    else if ("addTask" in d) taskForm();
    else if (d.editTask)
      taskForm(items("tasks").find((t) => t.id === d.editTask));
    else if (d.brief) {
      b.disabled = true;
      await showBrief(d.brief);
    } else if (d.analyze) {
      b.disabled = true;
      b.textContent = "Checking evidence…";
      const box = document.createElement("div");
      box.className = "analysis-running";
      box.innerHTML =
        '<span class="running-dot"></span><div><b>Reviewing this incident</b><small>Waiting for scoped tool checks to return.</small></div>';
      b.closest(".card").append(box);
      try {
        await mutate(
          "analysis.run",
          { incidentId: d.analyze },
          { render: false },
        );
        render();
      } finally {
        box.remove();
        b.textContent = "Analyze affected path";
      }
    } else if (d.coverage) {
      b.disabled = true;
      const r = await action("escalation.check", { incidentId: d.coverage });
      state.coverage[d.coverage] = r.result;
      if (r.state) acceptSnapshot(r.state);
      render();
    } else if (d.prepare) {
      b.disabled = true;
      await runResponse("prepare", d.prepare);
    } else if (d.approve) {
      b.disabled = true;
      await runResponse("approve", d.approve, d.digest);
    } else if (d.fallback) {
      b.disabled = true;
      await runResponse("fallback", d.fallback);
    } else if (d.resolve) {
      b.disabled = true;
      await runResponse("resolve", d.resolve);
    } else if (d.readNotice) {
      b.disabled = true;
      await mutate(
        "notification.read",
        { id: d.readNotice },
        { message: "Notice dismissed", render: false },
      );
      b.blur();
      refreshChrome();
    }
  } catch (error) {
    toast(explainError(error), true);
  } finally {
    b.disabled = false;
  }
});
document.addEventListener("click", (e) => {
  if (e.target.matches(".scrim")) closeOverlay();
  if (!e.target.closest("[data-picker]"))
    document
      .querySelectorAll(".picker-popover")
      .forEach((x) => (x.hidden = true));
  if (!e.target.closest("#context-menu")) {
    const menu = document.querySelector("#context-menu");
    if (menu) menu.hidden = true;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeOverlay();
    document
      .querySelectorAll(".picker-popover")
      .forEach((p) => (p.hidden = true));
    document.querySelector("#context-menu")?.setAttribute("hidden", "");
  }
});
window.addEventListener("tether:expired", (event) => {
  if (event.detail?.token !== auth.token()) return;
  auth.set(null);
  resetSessionState();
  loginView("Your session expired. Sign in again.");
});
load();
