#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  startPeer,
  type PeerConfig,
} from "../../packages/communications/index.ts";

const configIndex = process.argv.indexOf("--config");
if (configIndex < 0 || !process.argv[configIndex + 1])
  throw new Error("usage: mesh-peer --config <path>");
const configPath = process.argv[configIndex + 1]!;
const config = JSON.parse(await readFile(configPath, "utf8")) as PeerConfig;
const peer = await startPeer(config);
function emit(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
emit({
  type: "ready",
  peerId: config.peerId,
  host: config.host ?? "127.0.0.1",
  port: config.port,
  pid: process.pid,
});
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += String(chunk);
  for (;;) {
    const i = input.indexOf("\n");
    if (i < 0) break;
    const line = input.slice(0, i);
    input = input.slice(i + 1);
    if (!line.trim()) continue;
    void handle(JSON.parse(line)).catch((error) =>
      emit({
        type: "error",
        requestId: JSON.parse(line).requestId,
        error: String(error?.message ?? error),
      }),
    );
  }
});
async function handle(command: any) {
  if (command.command === "send")
    emit({
      type: "sent",
      requestId: command.requestId,
      messageId: await peer.send(command.request),
    });
  else if (command.command === "status")
    emit({
      type: "status",
      requestId: command.requestId,
      status: peer.status(command.messageId),
    });
  else if (command.command === "inbox")
    emit({ type: "inbox", requestId: command.requestId, items: peer.inbox() });
  else if (command.command === "events")
    emit({
      type: "events",
      requestId: command.requestId,
      items: peer.events(),
    });
  else if (command.command === "prove_cannot_decrypt")
    emit({
      type: "decryption_probe",
      requestId: command.requestId,
      cannotDecrypt: peer.cannotDecryptCached(command.messageId),
    });
  else if (command.command === "shutdown") {
    await peer.stop();
    emit({ type: "stopped", requestId: command.requestId });
    process.exit(0);
  } else throw new Error("unknown command");
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void peer.stop().finally(() => process.exit(0)));
