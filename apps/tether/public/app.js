import { api, auth, login, logout, action, connectEvents } from "./api.js";
import { TetherCanvas } from "./canvas.js";
import { icon, tetherLogo } from "./icons.js";
import {
  escapeHtml,
  nodeInspector,
  nodeForm,
  peopleView,
  personForm,
  importSheet,
  incidentDrawer,
  incidentForm,
  settingsForm,
  setupView,
} from "./panels.js";

const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");
const state = {
  data: null,
  view: "canvas",
  selected: null,
  sheet: null,
  incident: null,
  stream: "offline",
  focus: false,
  filter: {},
  importRows: null,
  canvasViewport: null,
  canvasSelection: [],
  coverage: {},
};
let canvas, disconnectEvents;
const caps = () =>
  new Set(state.data?.permissions || state.data?.capabilities || []);
const can = (...values) => values.some((v) => caps().has(v)) || caps().has("*");
const toast = (message, kind = "ok") => {
  toastEl.textContent = message;
  toastEl.className = `show ${kind}`;
  clearTimeout(toastEl.timer);
  toastEl.timer = setTimeout(() => (toastEl.className = ""), 3200);
};
const unwrap = (d) => d?.data || d?.state || d;
const observedResult = (result) =>
  result?.verified === true || result?.state === "verified"
    ? "verified"
    : result?.verified === false || result?.state === "failed"
      ? "failed"
      : "unknown";
const incidentAnalysis = (data, incidentId) =>
  data?.analysisByIncident?.[incidentId] || null;
const incidentProposal = (data, incidentId) =>
  data?.proposalsByIncident?.[incidentId] || null;

function loginView(error = "") {
  app.innerHTML = `<main class="login-shell"><section class="login-art"><div class="login-brand">${tetherLogo()}</div><div><span class="eyebrow">Company operations</span><h1>Company work,<br>connected.</h1><p>Map systems, coordinate people, and respond with clear authority.</p></div><div class="login-orbit"><span></span><i></i><b></b></div></section><form class="login-card" id="login-form"><div class="mobile-brand">${tetherLogo()}</div><span class="eyebrow">Welcome back</span><h2>Sign in to Tether</h2><p>Your access follows your verified company membership.</p><label><span>Work email</span><input name="email" type="email" autocomplete="username" required autofocus></label><label><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label><p class="form-error">${escapeHtml(error)}</p><button type="submit" class="primary wide">Sign in</button><small>Each browser tab keeps its own session.</small></form></main>`;
  app.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      button = form.querySelector("button");
    button.disabled = true;
    try {
      await login(form.email.value, form.password.value);
      await load();
    } catch (err) {
      form.querySelector(".form-error").textContent = err.message;
      button.disabled = false;
    }
  };
}

async function load(quiet = false) {
  if (!auth.get()) return loginView();
  try {
    state.data = unwrap(await api("/api/state"));
    if (!state.data?.user) state.data.user = auth.get().user;
    render();
    if (!quiet) startEvents();
  } catch (err) {
    if (err.status === 401) {
      auth.set(null);
      loginView("Your session expired. Please sign in again.");
    } else {
      app.innerHTML = `<div class="fatal"><h1>Tether could not open</h1><p>${escapeHtml(err.message)}</p><button class="primary" id="retry">Retry</button></div>`;
      app.querySelector("#retry").onclick = () => load();
    }
  }
}

function startEvents() {
  disconnectEvents?.();
  disconnectEvents = connectEvents(
    (next) => refreshLive(unwrap(next)),
    (status) => {
      state.stream = status;
      document
        .querySelector("#stream-state")
        ?.setAttribute("data-state", status);
      document.querySelector("#stream-state")?.replaceChildren(status);
    },
  );
}

function refreshLive(next) {
  state.data = next;
  if (state.sheet && state.sheet !== "incident") return;
  let draft = "",
    tab = "overview";
  if (state.sheet === "incident") {
    draft = document.querySelector("#message-form textarea")?.value || "";
    tab =
      document.querySelector("[data-incident-tab].active")?.dataset
        .incidentTab || "overview";
    const current = (next.incidents || []).find(
      (i) => i.id === state.incident?.id,
    );
    if (current) {
      const members = new Map((next.members || []).map((m) => [m.id, m]));
      state.incident = {
        ...current,
        tasks: (next.tasks || [])
          .filter((t) => t.incidentId === current.id)
          .map((t) => ({ ...t, ownerName: members.get(t.ownerId)?.name })),
        messages: (next.messages || [])
          .filter((m) => m.incidentId === current.id)
          .map((m) => ({ ...m, authorName: members.get(m.authorId)?.name })),
        proposal: incidentProposal(next, current.id),
        analysis: incidentAnalysis(next, current.id),
      };
    }
  }
  render();
  if (state.sheet === "incident") {
    document.querySelector(`[data-incident-tab="${tab}"]`)?.click();
    const input = document.querySelector("#message-form textarea");
    if (input) input.value = draft;
  }
}

function shell(main) {
  const u = state.data.user,
    activeIncident =
      state.incident ||
      (state.data.incidents || []).find(
        (i) => !["resolved", "closed"].includes(i.status),
      ),
    notice = (state.data.notifications || []).find((n) => !n.readAt);
  return `<div class="app-shell"><aside class="rail"><a class="rail-brand" href="#" data-view="canvas" aria-label="Tether">${tetherLogo(false)}</a><nav><button data-view="canvas" class="${state.view === "canvas" ? "active" : ""}" aria-label="Canvas">${icon("canvas")}<span>Canvas</span></button><button data-view="people" class="${state.view === "people" ? "active" : ""}" aria-label="People">${icon("people")}<span>People</span></button><button data-view="incidents" class="${state.view === "incidents" ? "active" : ""}" aria-label="Incidents">${icon("incident")}<span>Response</span>${activeIncident ? "<i></i>" : ""}</button>${can("organization:admin") ? `<button data-view="setup" class="${state.view === "setup" ? "active" : ""}" aria-label="Setup">${icon("settings")}<span>Setup</span></button>` : ""}</nav><button class="user-button" data-user-menu><span class="avatar">${escapeHtml(
    (u.name || u.displayName || "?")
      .split(" ")
      .map((x) => x[0])
      .join("")
      .slice(0, 2),
  )}</span><span>${escapeHtml(u.name || u.displayName)}</span></button></aside><section class="workspace"><header class="topbar"><div class="mobile-top-brand">${tetherLogo()}</div><div class="company"><b>${escapeHtml(state.data.organization?.name || "Northstar Compute")}</b><span>Company workspace</span></div><div class="top-actions"><span class="stream-pill" id="stream-state" data-state="${state.stream}">${state.stream}</span>${activeIncident ? `<button class="incident-pill" data-open-incident="${escapeHtml(activeIncident.id)}"><span></span>${escapeHtml(activeIncident.title)} ${icon("message")}</button>` : ""}${can("graph:write") ? `<button class="primary" data-add-node>${icon("plus")}<span>Add node</span></button>` : ""}</div></header>${notice ? `<div class="notice-bar"><b>Company notice</b><span>${escapeHtml(notice.message || notice.text)}</span></div>` : ""}${main}<nav class="bottom-nav"><button data-view="canvas" class="${state.view === "canvas" ? "active" : ""}">${icon("canvas")}<span>Canvas</span></button><button data-view="people" class="${state.view === "people" ? "active" : ""}">${icon("people")}<span>People</span></button><button data-view="incidents" class="${state.view === "incidents" ? "active" : ""}">${icon("incident")}<span>Response</span></button><button data-mobile-actions>${icon("menu")}<span>More</span></button></nav></section><div id="overlay"></div></div>`;
}

function canvasView() {
  const regions = state.data.regions || [];
  return `<main class="canvas-page"><div class="canvas-toolbar"><div class="segmented"><button class="active">System map</button></div><label><span class="sr-only">Region</span><select id="region-select"><option value="">All regions</option>${regions.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("")}</select></label><button class="tool-button" data-fit>${icon("fit")} Fit</button>${can("incident:create") ? `<button class="tool-button selection-action" data-create-from-selection hidden>Create response workspace</button>` : ""}<span class="gesture-hint">Scroll to pan · Shift + scroll to zoom</span></div><section id="canvas" aria-label="Company system canvas"></section>${state.focus ? `<div class="focus-chip"><span>Incident focus</span><b>${escapeHtml(state.incident?.title || "Affected area")}</b><button data-fit-focus>Refocus</button><button data-exit-focus>Exit focus</button><button data-hide-focus aria-label="Hide">${icon("close")}</button></div>` : ""}<div class="canvas-legend"><span><i class="healthy"></i>Healthy</span><span><i class="watch"></i>Watch</span><span><i class="affected"></i>Affected</span></div></main>`;
}

function incidentsView() {
  const incidents = state.data.incidents || [];
  return `<main class="page incidents-page"><header class="page-header"><div><span class="eyebrow">Response workspaces</span><h1>Incidents</h1><p>Observed evidence, scoped work, and exact-action review.</p></div>${can("incident:create") ? '<button class="primary" data-create-incident>Create workspace</button>' : ""}</header><section class="incident-list">${incidents.map((i) => `<button class="incident-card" data-open-incident="${escapeHtml(i.id)}"><span class="severity ${escapeHtml(i.severity || "medium")}">${escapeHtml(i.severity || "medium")}</span><div><h2>${escapeHtml(i.title)}</h2><p>${escapeHtml(i.observation || i.description || "")}</p><small>${escapeHtml(i.status || "open")}</small></div><span>Open →</span></button>`).join("") || '<div class="empty"><h2>No active response</h2><p>The company canvas is ready. Start a workspace only when there is an observation to investigate.</p></div>'}</section></main>`;
}

function render() {
  if (canvas) {
    state.canvasViewport = { ...canvas.viewport };
    state.canvasSelection = [...canvas.selection];
    canvas.dispose();
    canvas = null;
  }
  const departmentNames = new Map(
    (state.data.departments || []).map((d) => [d.id, d.name]),
  );
  const people = (state.data.members || []).map((p) => ({
    ...p,
    department:
      departmentNames.get(p.departmentId) || p.departmentName || "Unassigned",
  }));
  let main =
    state.view === "people"
      ? peopleView(filteredPeople(people), state.filter, can("directory:write"))
      : state.view === "setup"
        ? setupView(state.data)
        : state.view === "incidents"
          ? incidentsView()
          : canvasView();
  app.innerHTML = shell(main);
  bindShell();
  if (state.view === "canvas") mountCanvas();
  if (state.sheet === "inspector")
    showOverlay(
      nodeInspector(
        state.selected,
        can("graph:write"),
        state.data.edges || [],
        state.data.nodes || [],
      ),
    );
  if (state.sheet === "nodeForm")
    showOverlay(
      nodeForm(state.selected || {}, people, state.data.regions || []),
    );
  if (state.sheet === "personForm")
    showOverlay(
      personForm(
        state.selected || {},
        state.data.departments || [],
        can("organization:admin"),
      ),
    );
  if (state.sheet === "import") showOverlay(importSheet(state.importKind));
  if (state.sheet === "incident")
    showOverlay(
      incidentDrawer(
        state.incident,
        state.data.user,
        state.data.members || [],
        state.data.nodes || [],
        state.data.permissions || [],
      ),
    );
  if (state.sheet === "settings")
    showOverlay(
      settingsForm(
        (state.data.members || []).find((m) => m.id === state.data.user.id) ||
          state.data.user,
      ),
    );
}

function filteredPeople(people) {
  const q = (state.filter.q || "").toLowerCase(),
    d = state.filter.department || "",
    a = state.filter.availability || "";
  return people.filter(
    (p) =>
      (!q ||
        [p.name, p.displayName, p.title, p.team].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(q),
        )) &&
      (!d || p.department === d) &&
      (!a || p.availability === a),
  );
}
function mountCanvas() {
  const el = document.querySelector("#canvas"),
    members = new Map((state.data.members || []).map((m) => [m.id, m])),
    repositories = state.data.repositories || [];
  const nodes = (state.data.nodes || []).map((n) => ({
    ...n,
    ownerName: members.get(n.ownerId)?.name || n.ownerName,
    repository: repositories.find((r) => r.nodeId === n.id) || n.repository,
  }));
  const selectionChanged = (ids) => {
    state.canvasSelection = ids;
    const button = document.querySelector("[data-create-from-selection]");
    if (button) button.hidden = !ids.length;
  };
  canvas = new TetherCanvas(el, {
    onSelect: (n) => {
      state.canvasSelection = [n.id];
      state.selected = n;
      state.sheet = "inspector";
      showOverlay(
        nodeInspector(n, can("graph:write"), state.data.edges || [], nodes),
      );
    },
    onSelectionChange: selectionChanged,
    onMove: (id, x, y) => {
      const n = (state.data.nodes || []).find((x) => x.id === id);
      action("node.move", {
        id,
        x,
        y,
        layoutRevision: n?.layoutRevision,
      }).catch((e) => toast(e.message, "error"));
    },
    onConnect: async (sourceId, targetId) => {
      try {
        const result = await action("edge.create", {
          sourceId,
          targetId,
          kind: "depends_on",
          label: "depends on",
        });
        state.data = result.state;
        render();
        toast("Dependency connected.");
      } catch (e) {
        toast(e.message, "error");
      }
    },
  });
  if (state.canvasViewport) canvas.viewport = { ...state.canvasViewport };
  canvas.selection = new Set(state.canvasSelection);
  canvas.setData(nodes, state.data.edges || []);
  if (!state.canvasViewport && nodes.length) {
    const rect = el.getBoundingClientRect();
    const visible = nodes.some((node) => {
      const left = node.x * canvas.viewport.zoom + canvas.viewport.x;
      const top = node.y * canvas.viewport.zoom + canvas.viewport.y;
      return (
        left < rect.width &&
        top < rect.height &&
        left + 220 > 0 &&
        top + 110 > 0
      );
    });
    if (!visible) canvas.fit();
  }
  selectionChanged(state.canvasSelection);
}

function showOverlay(html) {
  const overlay = document.querySelector("#overlay");
  overlay.innerHTML = `<div class="scrim" data-close="sheet"></div>${html}`;
  requestAnimationFrame(() => overlay.classList.add("open"));
  bindOverlay();
}
function closeSheet() {
  state.sheet = null;
  state.selected = null;
  render();
}

function bindShell() {
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = (e) => {
        e.preventDefault();
        state.view = b.dataset.view;
        state.sheet = null;
        render();
      }),
  );
  document.querySelector("[data-add-node]")?.addEventListener("click", () => {
    state.selected = null;
    state.sheet = "nodeForm";
    showOverlay(
      nodeForm({}, state.data.members || [], state.data.regions || []),
    );
  });
  document
    .querySelector("[data-fit]")
    ?.addEventListener("click", () => canvas?.fit());
  document
    .querySelector("[data-fit-focus]")
    ?.addEventListener("click", () =>
      canvas?.fit((state.incident || state.data.activeIncident)?.nodeIds || []),
    );
  document.querySelector("[data-exit-focus]")?.addEventListener("click", () => {
    state.focus = false;
    canvas?.fit();
    render();
  });
  document
    .querySelector("[data-hide-focus]")
    ?.addEventListener("click", (e) =>
      e.currentTarget.closest(".focus-chip").remove(),
    );
  document
    .querySelectorAll("[data-open-incident]")
    .forEach((b) => (b.onclick = () => openIncident(b.dataset.openIncident)));
  document
    .querySelectorAll("[data-user-menu]")
    .forEach((b) => b.addEventListener("click", () => showUserMenu()));
  document
    .querySelector("[data-mobile-actions]")
    ?.addEventListener("click", showMobileActions);
  document
    .querySelector("[data-create-incident]")
    ?.addEventListener("click", () => {
      state.sheet = "incidentForm";
      showOverlay(
        incidentForm(
          state.data.nodes || [],
          state.data.members || [],
          state.data.regions || [],
        ),
      );
    });
  document
    .querySelector("[data-create-from-selection]")
    ?.addEventListener("click", () => openIncidentForm(state.canvasSelection));
  document.querySelector("#region-select")?.addEventListener("change", (e) => {
    const ids = (state.data.nodes || [])
      .filter((n) => !e.target.value || n.regionId === e.target.value)
      .map((n) => n.id);
    canvas?.fit(ids);
  });
  const search = document.querySelector("#people-search"),
    dept = document.querySelector("#department-filter"),
    avail = document.querySelector("#availability-filter");
  if (search) {
    let t;
    search.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.filter.q = search.value;
        render();
        document.querySelector("#people-search")?.focus();
      }, 150);
    };
    dept.onchange = () => {
      state.filter.department = dept.value;
      render();
    };
    avail.onchange = () => {
      state.filter.availability = avail.value;
      render();
    };
  }
  document.querySelectorAll("[data-add-person]").forEach(
    (b) =>
      (b.onclick = () => {
        state.selected = null;
        state.sheet = "personForm";
        showOverlay(
          personForm(
            {},
            state.data.departments || [],
            can("organization:admin"),
          ),
        );
      }),
  );
  document.querySelectorAll("[data-edit-person]").forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        state.selected = (state.data.members || []).find(
          (p) => p.id === b.dataset.editPerson,
        );
        state.sheet = "personForm";
        showOverlay(
          personForm(
            state.selected,
            state.data.departments || [],
            can("organization:admin"),
          ),
        );
      }),
  );
  document.querySelectorAll("[data-import]").forEach(
    (b) =>
      (b.onclick = () => {
        state.importKind = b.dataset.import;
        state.sheet = "import";
        showOverlay(importSheet(state.importKind));
      }),
  );
}

function showUserMenu() {
  document.querySelector("#overlay").innerHTML =
    `<div class="scrim" data-close="sheet"></div><div class="user-menu"><b>${escapeHtml(state.data.user.name || state.data.user.displayName)}</b><span>${escapeHtml(state.data.user.title || state.data.user.role || "Member")}</span><button data-my-settings>My hours and notifications</button><button id="logout">${icon("logout")} Sign out</button></div>`;
  document.querySelector("#overlay").classList.add("open");
  document.querySelector("[data-my-settings]").onclick = () => {
    state.sheet = "settings";
    showOverlay(
      settingsForm(
        (state.data.members || []).find((m) => m.id === state.data.user.id) ||
          state.data.user,
      ),
    );
  };
  document.querySelector("#logout").onclick = async () => {
    await logout();
    loginView();
  };
  document.querySelector(".scrim").onclick = closeSheet;
}
function openIncidentForm(selectedIds = []) {
  state.sheet = "incidentForm";
  showOverlay(
    incidentForm(
      state.data.nodes || [],
      state.data.members || [],
      state.data.regions || [],
      selectedIds,
    ),
  );
}
function showMobileActions() {
  document.querySelector("#overlay").innerHTML =
    `<div class="scrim"></div><div class="user-menu mobile-actions"><b>Quick actions</b>${can("graph:write") ? "<button data-quick-node>Add node</button>" : ""}${can("incident:create") ? "<button data-quick-incident>Create response workspace</button>" : ""}<button data-quick-settings>My hours and notifications</button><button id="logout">${icon("logout")} Sign out</button></div>`;
  document.querySelector("#overlay").classList.add("open");
  document.querySelector(".scrim").onclick = closeSheet;
  document.querySelector("[data-quick-node]")?.addEventListener("click", () => {
    state.sheet = "nodeForm";
    showOverlay(
      nodeForm({}, state.data.members || [], state.data.regions || []),
    );
  });
  document
    .querySelector("[data-quick-incident]")
    ?.addEventListener("click", () => openIncidentForm(state.canvasSelection));
  document.querySelector("[data-quick-settings]").onclick = () => {
    state.sheet = "settings";
    showOverlay(
      settingsForm(
        (state.data.members || []).find((m) => m.id === state.data.user.id) ||
          state.data.user,
      ),
    );
  };
  document.querySelector("#logout").onclick = async () => {
    await logout();
    loginView();
  };
}
async function openIncident(id, requestedTab) {
  const activeTab =
    requestedTab ||
    (state.incident?.id === id
      ? document.querySelector("[data-incident-tab].active")?.dataset
          .incidentTab
      : null);
  const incident = (state.data.incidents || []).find((i) => i.id === id);
  if (!incident) return;
  const members = new Map((state.data.members || []).map((m) => [m.id, m]));
  state.incident = {
    ...incident,
    tasks: (state.data.tasks || [])
      .filter((t) => t.incidentId === id)
      .map((t) => ({ ...t, ownerName: members.get(t.ownerId)?.name })),
    messages: (state.data.messages || [])
      .filter((m) => m.incidentId === id)
      .map((m) => ({ ...m, authorName: members.get(m.authorId)?.name })),
    proposal: incidentProposal(state.data, id),
    analysis: incidentAnalysis(state.data, id),
    coverage: state.coverage[id],
  };
  state.sheet = "incident";
  showOverlay(
    incidentDrawer(
      state.incident,
      state.data.user,
      state.data.members || [],
      state.data.nodes || [],
      state.data.permissions || [],
    ),
  );
  if (activeTab)
    document.querySelector(`[data-incident-tab="${activeTab}"]`)?.click();
}

function bindOverlay() {
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = closeSheet));
  document.querySelectorAll("[data-copy]").forEach(
    (b) =>
      (b.onclick = async () => {
        await navigator.clipboard.writeText(b.dataset.copy);
        toast("Copied.");
      }),
  );
  document.querySelector("[data-edit-node]")?.addEventListener("click", () => {
    state.sheet = "nodeForm";
    showOverlay(
      nodeForm(
        state.selected,
        state.data.members || [],
        state.data.regions || [],
      ),
    );
  });
  document
    .querySelector("[data-source]")
    ?.addEventListener("click", openSource);
  document
    .querySelector("[data-delete-node]")
    ?.addEventListener("click", async () => {
      if (!confirm(`Delete ${state.selected.name}?`)) return;
      try {
        const result = await action("node.delete", {
          id: state.selected.id,
          semanticRevision: state.selected.semanticRevision,
        });
        state.data = result.state;
        closeSheet();
        render();
        toast("Node deleted.");
      } catch (e) {
        toast(e.message, "error");
      }
    });
  document.querySelectorAll("[data-delete-edge]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          const result = await action("edge.delete", {
            id: b.dataset.deleteEdge,
            revision: Number(b.dataset.revision),
          });
          state.data = result.state;
          const selected = (state.data.nodes || []).find(
            (n) => n.id === state.selected.id,
          );
          state.selected = selected;
          showOverlay(
            nodeInspector(
              selected,
              can("graph:write"),
              state.data.edges || [],
              state.data.nodes || [],
            ),
          );
          toast("Relationship removed.");
        } catch (error) {
          toast(error.message, "error");
        }
      }),
  );
  document.querySelector("#node-form")?.addEventListener("submit", saveNode);
  document
    .querySelector("#person-form")
    ?.addEventListener("submit", savePerson);
  document
    .querySelector("#import-form")
    ?.addEventListener("change", previewImport);
  document
    .querySelector("#import-form")
    ?.addEventListener("submit", confirmImport);
  document
    .querySelector("#incident-form")
    ?.addEventListener("submit", saveIncident);
  document
    .querySelector("#message-form")
    ?.addEventListener("submit", sendMessage);
  document.querySelector("#task-form")?.addEventListener("submit", createTask);
  document
    .querySelector("#workspace-form")
    ?.addEventListener("submit", saveWorkspace);
  document
    .querySelector("#settings-form")
    ?.addEventListener("submit", saveSettings);
  document.querySelectorAll("[data-incident-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        document
          .querySelectorAll("[data-incident-tab]")
          .forEach((x) => x.classList.toggle("active", x === b));
        document
          .querySelectorAll("[data-tab-content]")
          .forEach(
            (x) => (x.hidden = x.dataset.tabContent !== b.dataset.incidentTab),
          );
      }),
  );
  document
    .querySelectorAll("[data-task-status]")
    .forEach(
      (b) => (b.onchange = () => updateTask(b.dataset.taskStatus, b.value)),
    );
  document
    .querySelector("[data-prepare-response]")
    ?.addEventListener("click", prepareResponse);
  document
    .querySelector("[data-focus-incident]")
    ?.addEventListener("click", focusIncident);
  document
    .querySelector("[data-approve-proposal]")
    ?.addEventListener("click", approveResponse);
  document
    .querySelector("[data-fallback]")
    ?.addEventListener("click", runFallback);
  document
    .querySelector("[data-resolve]")
    ?.addEventListener("click", runResolve);
  document.querySelector("[data-analyze]")?.addEventListener("click", analyze);
  document
    .querySelector("[data-check-coverage]")
    ?.addEventListener("click", checkCoverage);
  document
    .querySelectorAll("[data-task-brief]")
    .forEach((b) => (b.onclick = () => openBrief(b.dataset.taskBrief)));
}

function formObject(form) {
  const fd = new FormData(form),
    o = Object.fromEntries(fd);
  for (const checkbox of form.querySelectorAll("input[type=checkbox]"))
    o[checkbox.name] = checkbox.checked;
  return o;
}
async function saveNode(e) {
  e.preventDefault();
  const form = e.currentTarget,
    button = form.querySelector("[type=submit]"),
    v = formObject(form);
  button.disabled = true;
  try {
    const existing = (state.data.nodes || []).find((n) => n.id === v.id);
    const payload = v.id
      ? {
          id: v.id,
          semanticRevision: existing?.semanticRevision,
          patch: {
            name: v.name,
            kind: v.type,
            description: v.description,
            regionId: v.regionId || null,
            ownerId: v.ownerId || null,
          },
        }
      : {
          name: v.name,
          kind: v.type,
          description: v.description,
          regionId: v.regionId || null,
          ownerId: v.ownerId || undefined,
          criticality: "medium",
          x: existing?.x || 220,
          y: existing?.y || 180,
        };
    let result = await action(v.id ? "node.update" : "node.create", payload, {
      expectedRevision: state.data.organization?.semanticRevision,
    });
    const nodeId = v.id || result.result?.id || result.result?.node?.id;
    if (v.path && nodeId)
      result = await action("repository.save", {
        nodeId,
        repository: "local:hackutd",
        revision: v.revision,
        path: v.path,
        lineStart: v.lineStart ? Number(v.lineStart) : undefined,
        lineEnd: v.lineEnd ? Number(v.lineEnd) : undefined,
      });
    state.data = result.state;
    closeSheet();
    render();
    toast(v.id ? "Node updated." : "Node created.");
  } catch (err) {
    form.querySelector(".form-error").textContent = err.message;
    button.disabled = false;
  }
}
async function savePerson(e) {
  e.preventDefault();
  const form = e.currentTarget,
    b = form.querySelector("[type=submit]"),
    v = formObject(form);
  b.disabled = true;
  try {
    let result;
    if (v.id) {
      const existing = (state.data.members || []).find((p) => p.id === v.id);
      result = await action("member.update", {
        id: v.id,
        revision: existing?.revision,
        patch: {
          name: v.name,
          title: v.title,
          departmentId: v.departmentId,
          team: v.team,
          ...(v.roleTemplate ? { roleTemplate: v.roleTemplate } : {}),
        },
      });
    } else {
      result = await action("member.create", {
        name: v.name,
        email: v.email,
        departmentId: v.departmentId,
        team: v.team,
        jobFamily: v.title,
        level: "Individual contributor",
        title: v.title,
        timezone: v.timezone,
      });
    }
    state.data = result.state;
    state.sheet = null;
    state.selected = null;
    render();
    toast(v.id ? "Profile updated." : "Employee profile added.");
  } catch (err) {
    form.querySelector(".form-error").textContent = err.message;
    b.disabled = false;
  }
}
async function saveIncident(e) {
  e.preventDefault();
  const form = e.currentTarget,
    b = form.querySelector("[type=submit]");
  b.disabled = true;
  const chosen = (name) =>
    [...form.elements[name].selectedOptions].map((o) => o.value);
  try {
    const response = await action(
      "incident.create",
      {
        title: form.elements.title.value,
        observation: form.elements.observation.value,
        nodeIds: chosen("nodeIds"),
        regionId: form.elements.regionId.value || undefined,
        memberIds: chosen("memberIds"),
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    state.data = response.state;
    closeSheet();
    render();
    toast("Incident workspace created.");
  } catch (err) {
    form.querySelector(".form-error").textContent = err.message;
    b.disabled = false;
  }
}
async function sendMessage(e) {
  e.preventDefault();
  const form = e.currentTarget,
    b = form.querySelector("button");
  b.disabled = true;
  try {
    const response = await action(
      "message.send",
      { incidentId: state.incident.id, text: form.elements.text.value },
      { idempotencyKey: crypto.randomUUID() },
    );
    state.data = response.state;
    await openIncident(state.incident.id);
    toast("Message sent.");
  } catch (err) {
    toast(err.message, "error");
    b.disabled = false;
  }
}
async function createTask(e) {
  e.preventDefault();
  const form = e.currentTarget,
    button = form.querySelector('[type="submit"]'),
    nodeIds = [...form.elements.nodeIds.selectedOptions].map((o) => o.value);
  button.disabled = true;
  try {
    const response = await action("task.create", {
      incidentId: state.incident.id,
      title: form.elements.title.value,
      ownerId: form.elements.ownerId.value,
      nodeIds,
    });
    state.data = response.state;
    await openIncident(state.incident.id);
    document.querySelector('[data-incident-tab="tasks"]')?.click();
    toast("Task assigned.");
  } catch (err) {
    form.querySelector(".form-error").textContent = err.message;
    button.disabled = false;
  }
}
async function saveWorkspace(e) {
  e.preventDefault();
  const form = e.currentTarget,
    button = form.querySelector('[type="submit"]'),
    selected = (name) =>
      [...form.elements[name].selectedOptions].map((o) => o.value);
  button.disabled = true;
  try {
    const response = await action("workspace.update", {
      id: state.incident.id,
      revision: state.incident.revision,
      memberIds: selected("memberIds"),
      nodeIds: selected("nodeIds"),
    });
    state.data = response.state;
    await openIncident(state.incident.id);
    toast("Workspace scope updated.");
  } catch (err) {
    form.querySelector(".form-error").textContent = err.message;
    button.disabled = false;
  }
}
async function saveSettings(e) {
  e.preventDefault();
  const form = e.currentTarget,
    button = form.querySelector('[type="submit"]'),
    values = formObject(form),
    current = (state.data.members || []).find(
      (m) => m.id === state.data.user.id,
    );
  button.disabled = true;
  try {
    const onCallWindows = values.accepted
      ? [
          {
            startsAt: new Date(values.onCallStart).toISOString(),
            endsAt: new Date(values.onCallEnd).toISOString(),
            accepted: true,
          },
        ]
      : [];
    const response = await action("settings.update", {
      timezone: values.timezone,
      availability: values.availability,
      workingHours: [
        {
          weekday: Number(values.weekday),
          start: values.start,
          end: values.end,
        },
      ],
      notifications: {
        routineInHours: values.routineInHours,
        afterHours: values.afterHours,
        channels: current?.notifications?.channels || ["in_app"],
        severities: current?.notifications?.severities || ["high", "critical"],
      },
      onCallWindows,
    });
    state.data = response.state;
    state.sheet = null;
    render();
    toast("Settings saved.");
  } catch (err) {
    form.querySelector(".form-error").textContent = err.message;
    button.disabled = false;
  }
}
async function updateTask(id, status) {
  const task = (state.data.tasks || []).find((t) => t.id === id);
  try {
    const response = await action("task.update", {
      id,
      revision: task?.revision,
      status,
    });
    state.data = response.state;
    await openIncident(state.incident.id);
    document.querySelector('[data-incident-tab="tasks"]')?.click();
    toast("Task status updated.");
  } catch (err) {
    toast(err.message, "error");
  }
}
function focusIncident() {
  state.sheet = null;
  state.focus = true;
  state.view = "canvas";
  render();
  canvas?.fit(state.incident?.nodeIds || []);
}
async function prepareResponse(e) {
  const b = e.currentTarget,
    out = document.querySelector("#proposal-result");
  b.disabled = true;
  try {
    const response = await action("response.prepare", {
      incidentId: b.dataset.prepareResponse,
    });
    state.data = response.state;
    await openIncident(b.dataset.prepareResponse, "action");
  } catch (err) {
    out.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  } finally {
    b.disabled = false;
  }
}
async function approveResponse(e) {
  const b = e.currentTarget;
  b.disabled = true;
  try {
    const response = await action("response.approve", {
      proposalId: b.dataset.approveProposal,
      digest: b.dataset.digest,
    });
    state.data = response.state;
    toast(`Fixed-route disable result: ${observedResult(response.result)}.`);
    await openIncident(state.incident.id);
  } catch (err) {
    toast(err.message, "error");
    b.disabled = false;
  }
}
async function runFallback(e) {
  const b = e.currentTarget;
  b.disabled = true;
  try {
    const response = await action("response.fallback", {
      incidentId: b.dataset.fallback,
    });
    state.data = response.state;
    toast(`Safe fallback check: ${observedResult(response.result)}.`);
    await openIncident(state.incident.id);
  } catch (err) {
    toast(err.message, "error");
    b.disabled = false;
  }
}
async function runResolve(e) {
  const b = e.currentTarget;
  b.disabled = true;
  try {
    const response = await action("response.resolve", {
      incidentId: b.dataset.resolve,
    });
    state.data = response.state;
    toast(`Resolution check: ${observedResult(response.result)}.`);
    await openIncident(state.incident.id);
  } catch (err) {
    toast(err.message, "error");
    b.disabled = false;
  }
}

async function previewImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const form = e.currentTarget,
    preview = form.querySelector("#import-preview");
  try {
    const text = await file.text();
    let rows;
    if (form.dataset.kind === "people") {
      const [header, ...lines] = text.trim().split(/\r?\n/);
      const keys = header.split(",").map((x) => x.trim());
      rows = lines
        .filter(Boolean)
        .map((line) =>
          Object.fromEntries(
            line.split(",").map((v, i) => [keys[i], v.trim()]),
          ),
        );
    } else rows = JSON.parse(text);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 150)
      throw new Error("Choose a file with 1 to 150 records.");
    state.importRows = rows;
    form.dataset.rawContent = text;
    delete form.dataset.previewId;
    preview.innerHTML = `<div class="import-summary"><b>${rows.length} records selected</b><span>${escapeHtml(Object.keys(rows[0]).join(" · "))}</span></div>`;
    form.querySelector("[type=submit]").textContent = "Preview import";
    form.querySelector("[type=submit]").disabled = false;
    form.querySelector(".form-error").textContent = "";
  } catch (err) {
    state.importRows = null;
    form.querySelector("[type=submit]").disabled = true;
    form.querySelector(".form-error").textContent = err.message;
  }
}
async function confirmImport(e) {
  e.preventDefault();
  const form = e.currentTarget,
    b = form.querySelector("[type=submit]");
  b.disabled = true;
  try {
    const content = form.dataset.rawContent;
    if (!form.dataset.previewId) {
      const format =
        form.dataset.kind === "people" ? "employees_csv" : "catalog_json";
      const preview = await action("import.preview", { format, content });
      form.dataset.previewId = preview.result.previewId;
      document.querySelector("#import-preview").innerHTML =
        `<div class="import-summary"><b>${escapeHtml(preview.result.summary || "Preview ready")}</b><span>${preview.result.errors?.length || 0} errors · ${preview.result.warnings?.length || 0} warnings</span></div>`;
      b.textContent = "Confirm import";
      b.disabled = (preview.result.errors?.length || 0) > 0;
      return;
    }
    const result = await action("import.commit", {
      previewId: form.dataset.previewId,
      semanticRevision: state.data.organization?.semanticRevision,
    });
    state.data = result.state;
    closeSheet();
    render();
    toast("Import committed.");
  } catch (err) {
    form.querySelector(".form-error").textContent = err.message;
    b.disabled = false;
  }
}

async function analyze(e) {
  const b = e.currentTarget,
    out = document.querySelector("#analysis-result");
  b.disabled = true;
  b.textContent = "Analyzing…";
  try {
    const response = await action("analysis.run", {
      incidentId: b.dataset.analyze,
    });
    state.data = response.state;
    await openIncident(state.incident.id);
  } catch (err) {
    out.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  } finally {
    b.disabled = false;
    b.textContent = "Analyze affected path";
  }
}

async function checkCoverage(e) {
  const button = e.currentTarget;
  button.disabled = true;
  try {
    const response = await action("escalation.check", {
      incidentId: state.incident.id,
    });
    state.coverage[state.incident.id] = response.result;
    await openIncident(state.incident.id);
    toast("Point-in-time coverage checked.");
  } catch (err) {
    toast(err.message, "error");
    button.disabled = false;
  }
}
async function openBrief(id) {
  try {
    const generated = await action("brief.generate", { taskId: id });
    state.data = generated.state;
    const brief = generated.result,
      text = brief.text || "";
    showOverlay(
      `<aside class="sheet brief-sheet"><header><div><span class="eyebrow">Coding agent handoff</span><h2>Task brief</h2></div><button type="button" class="icon-button" data-close="form" aria-label="Close">${icon("close")}</button></header><div class="sheet-scroll"><div class="brief-meta"><span>Packet ${escapeHtml(brief.id)}</span><span>Revision ${escapeHtml(brief.snapshotRevision)}</span></div><pre>${escapeHtml(text)}</pre><button type="button" class="primary wide" data-copy-brief>Copy prompt</button></div></aside>`,
    );
    document.querySelector("[data-copy-brief]").onclick = async () => {
      try {
        await action("brief.copy", { id: brief.id });
        await navigator.clipboard.writeText(text);
        toast("Task prompt copied.");
      } catch (error) {
        toast(error.message, "error");
      }
    };
    bindOverlay();
  } catch (e) {
    toast(e.message, "error");
  }
}
async function openSource(e) {
  try {
    const source = await api(
      `/api/source?id=${encodeURIComponent(e.currentTarget.dataset.source)}`,
    );
    showOverlay(
      `<aside class="sheet brief-sheet"><header><div><span class="eyebrow">Pinned source · ${escapeHtml(source.revision)}</span><h2>${escapeHtml(source.path)}</h2></div><button type="button" class="icon-button" data-close="form" aria-label="Close">${icon("close")}</button></header><div class="sheet-scroll"><button type="button" class="soft-button" data-copy="${escapeHtml(source.path)}">${icon("copy")} Copy path</button><pre>${escapeHtml(source.text)}</pre></div></aside>`,
    );
    bindOverlay();
  } catch (error) {
    toast(error.message, "error");
  }
}

window.addEventListener("tether:expired", () => {
  auth.set(null);
  loginView("Your session expired. Please sign in again.");
});
load();
