const SESSION_KEY = "tether.session";
let streamController;
let sessionVersion = 0;

export const auth = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  },
  set(value) {
    sessionVersion++;
    value
      ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
      : sessionStorage.removeItem(SESSION_KEY);
  },
  token() {
    return this.get()?.token || "";
  },
};

export async function api(path, options = {}) {
  const token = auth.token(),
    version = sessionVersion;
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  let response, text;
  try {
    response = await fetch(path, { ...options, headers });
    text = await response.text();
  } catch (error) {
    if (
      path !== "/api/logout" &&
      (token !== auth.token() || version !== sessionVersion)
    )
      throw Object.assign(new Error("This session is no longer active."), {
        staleSession: true,
      });
    throw error;
  }
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  // Responses belong to the session that sent them, including failed requests.
  if (
    path !== "/api/logout" &&
    (token !== auth.token() || version !== sessionVersion)
  )
    throw Object.assign(new Error("This session is no longer active."), {
      staleSession: true,
    });
  if (
    response.status === 401 &&
    token &&
    path !== "/api/login" &&
    path !== "/api/logout"
  )
    window.dispatchEvent(
      new CustomEvent("tether:expired", { detail: { token } }),
    );
  if (!response.ok)
    throw Object.assign(
      new Error(
        body?.error || body?.message || `Request failed (${response.status})`,
      ),
      {
        status: response.status,
        body,
        staleSession:
          path !== "/api/logout" &&
          (token !== auth.token() || version !== sessionVersion),
      },
    );
  return body;
}

export async function login(email, password) {
  const version = sessionVersion;
  const result = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (version !== sessionVersion)
    throw Object.assign(new Error("This session is no longer active."), {
      staleSession: true,
    });
  const session = {
    token: result.token,
    user: result.user,
    expiresAt: result.expiresAt,
  };
  if (!session.token || !session.user)
    throw new Error("The server did not return a complete session.");
  auth.set(session);
  return session;
}

export async function logout() {
  // Start the server revocation with the current token, then close local access
  // immediately. Its eventual response must never clear a newer login.
  const request = api("/api/logout", { method: "POST" });
  const controller = streamController;
  auth.set(null);
  controller?.abort();
  return await request;
}

export function connectEvents(onEvent, onState) {
  streamController?.abort();
  if (!auth.token()) return () => {};
  streamController = new AbortController();
  const controller = streamController,
    token = auth.token(),
    version = sessionVersion;
  const isCurrent = () =>
    !controller.signal.aborted &&
    auth.token() === token &&
    sessionVersion === version;
  let cursor = 0,
    retry;
  const open = async () => {
    if (!isCurrent()) return;
    try {
      const response = await fetch(`/api/events?cursor=${cursor}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error("Live updates unavailable");
      if (!isCurrent()) return;
      onState?.("live");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (isCurrent()) {
        const { value, done } = await reader.read();
        if (done || !isCurrent()) break;
        buffer += decoder.decode(value, { stream: true });
        const records = buffer.split("\n\n");
        buffer = records.pop() || "";
        for (const record of records) {
          if (!isCurrent()) break;
          let data = "",
            event = "",
            id = "";
          for (const line of record.split("\n")) {
            if (line.startsWith("data:")) data += line.slice(5).trim();
            else if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("id:")) id = line.slice(3).trim();
          }
          if (id) cursor = Number(id) || cursor;
          if (data && (!event || event === "state")) {
            try {
              onEvent(JSON.parse(data));
            } catch {}
          }
        }
      }
      if (isCurrent()) {
        onState?.("reconnecting");
        retry = setTimeout(open, 900);
      }
    } catch {
      if (isCurrent()) {
        onState?.("reconnecting");
        retry = setTimeout(open, 1400);
      }
    }
  };
  open();
  return () => {
    clearTimeout(retry);
    controller.abort();
  };
}

export function action(type, payload, options = {}) {
  return api("/api/actions", {
    method: "POST",
    body: JSON.stringify({ type, payload, ...options }),
  });
}
