import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanonicalStore } from "../packages/storage/src/index.ts";
import { ContinuityService } from "../packages/workflows/src/index.ts";
import {
  seedPantryScenario,
  pantryActors,
  pantryIncidentId,
  pantryOrganizationId,
} from "../fixtures/pantry/index.ts";
import {
  ApplicationAuthority,
  createAuthorityConfig,
} from "../apps/authority/index.ts";
import { connectBoundedMcp } from "../apps/agent-runtime/mcp-client.ts";

test(
  "authority credentials bind canonical actor revision and MCP errors stay sanitized",
  { timeout: 15_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "authority-mcp-")),
      dbPath = join(root, "domain.sqlite"),
      configPath = join(root, "authority.json");
    const store = new CanonicalStore(dbPath),
      service = seedPantryScenario(store, () => new Date());
    store.close();
    const tokens = await createAuthorityConfig(configPath, dbPath, [
      {
        actorId: "actor_agent",
        organizationId: pantryOrganizationId,
        incidentIds: [pantryIncidentId],
        capabilities: ["read", "simulate", "propose"],
      },
    ]);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    const connection = await connectBoundedMcp({
      authorityConfigPath: configPath,
      credential: tokens.actor_agent!,
    });
    try {
      const scope = {
        organizationId: pantryOrganizationId,
        incidentId: pantryIncidentId,
      };
      const initial = await connection.client.callTool({
        name: "get_incident",
        arguments: scope,
      });
      assert.notEqual(initial.isError, true);
      const malformed = await connection.client.callTool({
        name: "submit_response_proposal",
        arguments: {
          ...scope,
          targetId: "arbitrary",
          secretPath: "/private/demo",
        },
      });
      assert.equal(malformed.isError, true);
      const malformedText = (malformed.content as any[])
        .map((item) => item.text ?? "")
        .join(" ");
      assert.doesNotMatch(malformedText, /private|sqlite|Zod|stack/i);
      const updateStore = new CanonicalStore(dbPath),
        updateService = new ContinuityService(updateStore);
      const agent = pantryActors.find((actor) => actor.id === "actor_agent")!;
      updateService.provisionActor(
        { ...agent, revision: 2 },
        "actor_commander",
      );
      updateStore.close();
      const stale = await connection.client.callTool({
        name: "get_incident",
        arguments: scope,
      });
      assert.equal(stale.isError, true);
      assert.equal((stale.content as any[])[0]?.text, "request_rejected");
    } finally {
      await connection.close();
    }
  },
);

test("authority configuration rejects nonexistent, cross-org, duplicate, and unknown fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "authority-config-")),
    dbPath = join(root, "domain.sqlite"),
    configPath = join(root, "authority.json");
  const store = new CanonicalStore(dbPath);
  seedPantryScenario(store, () => new Date());
  store.close();
  await assert.rejects(
    () =>
      createAuthorityConfig(configPath, dbPath, [
        {
          actorId: "missing",
          organizationId: pantryOrganizationId,
          incidentIds: [pantryIncidentId],
          capabilities: ["read"],
        },
      ]),
    /absent/,
  );
  await assert.rejects(
    () =>
      createAuthorityConfig(configPath, dbPath, [
        {
          actorId: "actor_agent",
          organizationId: "org_other_demo",
          incidentIds: [pantryIncidentId],
          capabilities: ["read"],
        },
      ]),
    /absent/,
  );
  await writeFile(
    configPath,
    JSON.stringify({ domainDbPath: dbPath, credentials: [], unexpected: true }),
    { mode: 0o600 },
  );
  await assert.rejects(() => ApplicationAuthority.open(configPath));
});
