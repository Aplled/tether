import { createServer } from "node:http";

const port = Number.parseInt(process.env.DEMO_FIXTURE_PORT ?? "", 10);
const token = process.env.DEMO_FIXTURE_TOKEN;
if (!Number.isSafeInteger(port) || port < 0 || port > 65535 || !token) {
  throw new Error("invalid fixed fixture configuration");
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ healthy: true, token }));
    return;
  }
  response.writeHead(404).end();
});

server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
  const address = server.address();
  if (address && typeof address !== "string")
    process.stdout.write(`PORT:${address.port}\n`);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
