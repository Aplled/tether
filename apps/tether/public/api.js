const SESSION_KEY = "tether.session";
let streamController;

export const auth = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  },
  set(value) {
    value
      ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
      : sessionStorage.removeItem(SESSION_KEY);
  },
  token() {
    return this.get()?.token || "";
  },
};

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (auth.token()) headers.set("Authorization", `Bearer ${auth.token()}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (response.status === 401)
    window.dispatchEvent(new CustomEvent("tether:expired"));
  if (!response.ok)
    throw Object.assign(
      new Error(
        body?.error || body?.message || `Request failed (${response.status})`,
      ),
      { status: response.status, body },
    );
  return body;
}

export async function login(email, password) {
  const result = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
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
  try {
    await api("/api/logout", { method: "POST" });
  } finally {
    auth.set(null);
    streamController?.abort();
  }
}

export function connectEvents(onEvent, onState) {
  streamController?.abort();
  if (!auth.token()) return () => {};
  streamController = new AbortController();
  const controller = streamController;
  let cursor = 0,
    retry;
  const open = async () => {
    if (controller.signal.aborted) return;
    try {
      const response = await fetch(`/api/events?cursor=${cursor}`, {
        headers: {
          Authorization: `Bearer ${auth.token()}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error("Live updates unavailable");
      onState?.("live");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const records = buffer.split("\n\n");
        buffer = records.pop() || "";
        for (const record of records) {
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
      if (!controller.signal.aborted) {
        onState?.("reconnecting");
        retry = setTimeout(open, 900);
      }
    } catch {
      if (!controller.signal.aborted) {
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
