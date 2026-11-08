import { createServer } from "node:http";

// Isolated synthetic fixture: the primary route intentionally reproduces the
// missing tenant ownership check. The fixed fallback path performs it.
let disabled = false;
const jobs = new Map([
  ["job-tenant-a", "tenant-a"],
  ["job-tenant-b", "tenant-b"],
]);

const server = createServer((request, response) => {
  const primary = request.url?.match(/^\/api\/v1\/jobs\/([^/]+)\/retry$/);
  const fallback = request.url?.match(
    /^\/fallback\/api\/v1\/jobs\/([^/]+)\/retry$/,
  );
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(
      JSON.stringify({ healthy: true, retryRouteEnabled: !disabled }),
    );
    return;
  }
  if (request.method === "POST" && primary) {
    const tenant = request.headers.authorization?.replace(/^Bearer /, "");
    if (tenant !== "tenant-a" && tenant !== "tenant-b")
      response.writeHead(401).end("valid customer token required");
    else if (disabled) response.writeHead(503).end("retry route disabled");
    // Deliberate fixture bug: authentication is present but ownership is not checked.
    else
      response
        .writeHead(202, { "content-type": "application/json" })
        .end(JSON.stringify({ accepted: true, jobId: primary[1] }));
    return;
  }
  if (request.method === "POST" && fallback) {
    const tenant = request.headers.authorization?.replace(/^Bearer /, "");
    const owner = jobs.get(fallback[1]!);
    if (tenant !== "tenant-a" && tenant !== "tenant-b")
      response.writeHead(401).end("valid customer token required");
    else if (!owner) response.writeHead(404).end();
    else if (tenant !== owner)
      response.writeHead(403).end("job ownership required");
    else
      response
        .writeHead(202, { "content-type": "application/json" })
        .end(JSON.stringify({ accepted: true, jobId: fallback[1] }));
    return;
  }
  response.writeHead(404).end();
});

server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
  const address = server.address();
  if (!address || typeof address === "string") process.exit(1);
  process.send?.({ type: "ready", port: address.port });
});

process.on("message", (message: any) => {
  if (message?.type === "disable") {
    disabled = true;
    process.send?.({
      requestId: message.requestId,
      ok: true,
      value: { disabled },
    });
  } else if (message?.type === "close") {
    process.send?.(
      { requestId: message.requestId, ok: true, value: null },
      () => server.close(() => process.exit(0)),
    );
  } else
    process.send?.({
      requestId: message?.requestId,
      ok: false,
      error: "unknown worker operation",
    });
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
