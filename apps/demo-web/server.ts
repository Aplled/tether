#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoSession } from "./session.ts";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");
try {
  process.loadEnvFile(resolve(root, "../..", ".env.local"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const portArg = process.argv.indexOf("--port");
const port = Number(
  process.env.DEMO_WEB_PORT ??
    (portArg >= 0 ? process.argv[portArg + 1] : 4173),
);
if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
  throw new Error("invalid port");
const runtimeDir = resolve(
  process.env.DEMO_WEB_RUNTIME ?? join(root, ".runtime"),
);
const token = randomBytes(32).toString("base64url");
const session = new DemoSession(runtimeDir);
await session.start();

const staticFiles: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/icons.js": ["icons.js", "text/javascript; charset=utf-8"],
  "/pretext.js": ["pretext.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};
const pretextFiles = new Set([
  "analysis.js",
  "gecko-line-breaks.js",
  "graphemes.js",
  "han-kerning.js",
  "layout.js",
  "line-break.js",
  "line-breaks.js",
  "line-text.js",
  "measurement.js",
  "prepare.js",
  "rich-inline.js",
]);
const pretextGeneratedFiles = new Set([
  "engine-break-data.js",
  "webkit-generic-families.js",
]);

function headers(extra: Record<string, string> = {}) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extra,
  };
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(
    status,
    headers({ "Content-Type": "application/json; charset=utf-8" }),
  );
  res.end(JSON.stringify(value));
}
function sameToken(value: string | undefined) {
  if (!value) return false;
  const a = Buffer.from(value),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
function actualPort() {
  const address = server.address();
  return address && typeof address === "object" ? address.port : port;
}
function hostAllowed(req: IncomingMessage) {
  const host = req.headers.host;
  return (
    host === `127.0.0.1:${actualPort()}` || host === `localhost:${actualPort()}`
  );
}
function originAllowed(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const activePort = actualPort();
  return (
    origin === `http://127.0.0.1:${activePort}` ||
    origin === `http://localhost:${activePort}`
  );
}
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > 65_536)
      throw Object.assign(new Error("request body exceeds 64 KiB"), {
        status: 413,
      });
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { status: 400 });
  }
}

const server = createServer(async (req, res) => {
  try {
    if (!hostAllowed(req) || !originAllowed(req))
      return json(res, 403, { error: "host or origin rejected" });
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.search || url.hash || url.pathname.includes(".."))
      return json(res, 404, { error: "not found" });
    if (req.method === "GET" && url.pathname === "/api/state")
      return json(res, 200, session.getState());
    if (req.method === "POST" && url.pathname === "/api/actions") {
      if (!sameToken(req.headers["x-demo-token"] as string | undefined))
        return json(res, 403, { error: "demo token required" });
      const result = await session.act(await body(req));
      return json(res, 200, result);
    }
    const vendorName = url.pathname.startsWith("/vendor/pretext/")
      ? url.pathname.slice("/vendor/pretext/".length)
      : "";
    const generatedName = url.pathname.startsWith("/vendor/pretext/generated/")
      ? url.pathname.slice("/vendor/pretext/generated/".length)
      : "";
    const item =
      staticFiles[url.pathname] ??
      (pretextFiles.has(vendorName)
        ? ([
            `vendor/pretext/${vendorName}`,
            "text/javascript; charset=utf-8",
          ] as [string, string])
        : pretextGeneratedFiles.has(generatedName)
          ? ([
              `vendor/pretext/generated/${generatedName}`,
              "text/javascript; charset=utf-8",
            ] as [string, string])
          : undefined);
    if (req.method !== "GET" || !item)
      return json(res, 404, { error: "not found" });
    const path = join(publicDir, item[0]);
    await access(path);
    if (item[0] === "index.html") {
      const html = (await readFile(path, "utf8")).replace(
        '<meta name="demo-token" content="">',
        `<meta name="demo-token" content="${token}">`,
      );
      res.writeHead(200, headers({ "Content-Type": item[1] }));
      return res.end(html);
    }
    res.writeHead(200, headers({ "Content-Type": item[1] }));
    createReadStream(path).pipe(res);
  } catch (error) {
    const e = error as Error & { status?: number };
    json(res, e.status ?? 400, { error: e.message || "request failed" });
  }
});

server.listen(port, "127.0.0.1", () => {
  const activePort = actualPort();
  process.stdout.write(
    `${JSON.stringify({ ready: true, url: `http://127.0.0.1:${activePort}`, runtimeDir })}\n`,
  );
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await session.close();
}
process.once("SIGINT", () => void close().then(() => process.exit(0)));
process.once("SIGTERM", () => void close().then(() => process.exit(0)));
process.once(
  "uncaughtException",
  (error) =>
    void close().finally(() => {
      console.error(error);
      process.exit(1);
    }),
);
process.once(
  "unhandledRejection",
  (error) =>
    void close().finally(() => {
      console.error(error);
      process.exit(1);
    }),
);
