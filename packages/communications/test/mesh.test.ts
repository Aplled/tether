import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const execFileAsync = promisify(execFile);

test(
  "three real peer processes relay, receipt, queue, and recover across relay restart",
  { timeout: 30_000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "mesh-integration-"));
    const result = await execFileAsync(
      process.execPath,
      [resolve("scripts/mesh-demo.ts"), "--output", output],
      { cwd: resolve("."), timeout: 25_000 },
    );
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.ok, true);
    const evidence = JSON.parse(
      await readFile(join(output, "evidence.json"), "utf8"),
    );
    assert.equal(evidence.topology.logicalPeers, 3);
    assert.equal(evidence.topology.directAtoCBlocked, true);
    assert.equal(evidence.topology.physicalDeviceMeshVerified, false);
    assert.equal(evidence.crypto.relayCannotDecrypt, true);
    assert.equal(evidence.persistence.statusAfterRelayCustody, "in_custody");
    assert.equal(evidence.persistence.relayHadDurableCustody, true);
    assert.equal(evidence.persistence.relayKilledAfterCustody, true);
    assert.equal(evidence.persistence.relayRestartedWithSameStore, true);
    assert.equal(evidence.messages[0].status.state, "recipient_acknowledged");
    assert.equal(evidence.messages[1].status.state, "recipient_acknowledged");
    assert.equal(evidence.recipientInbox.length, 2);
    for (const id of ["peer-a", "peer-b", "peer-c"]) {
      const mode = (await stat(join(output, id, "identity.json"))).mode & 0o777;
      assert.equal(mode, 0o600);
    }
    const bdb = new DatabaseSync(join(output, "peer-b", "mesh.sqlite"), {
      readOnly: true,
    });
    const seen = bdb.prepare("SELECT COUNT(*) count FROM seen").get() as {
      count: number;
    };
    assert.equal(seen.count, 2);
    bdb.close();
  },
);
