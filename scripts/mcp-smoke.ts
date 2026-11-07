#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanonicalStore } from "../packages/storage/src/index.ts";
import {
  seedPantryScenario,
  pantryIncidentId,
  pantryOrganizationId,
  trustedEvidence,
} from "../fixtures/pantry/index.ts";
import { createAuthorityConfig } from "../apps/authority/index.ts";
import {
  connectBoundedMcp,
  toolResultValue,
} from "../apps/agent-runtime/mcp-client.ts";

const root = await mkdtemp(join(tmpdir(), "hackutd-mcp-smoke-")),
  dbPath = join(root, "domain.sqlite"),
  configPath = join(root, "authority.json");
const store = new CanonicalStore(dbPath),
  service = seedPantryScenario(store);
service.recordEvidence(
  trustedEvidence(
    "evidence_suspicious_scheduler",
    "observation",
    "scheduler",
    "Synthetic suspicious scheduler signal",
  ),
  "actor_verifier",
);
store.close();
const tokens = await createAuthorityConfig(configPath, dbPath, [
  {
    actorId: "actor_agent",
    organizationId: pantryOrganizationId,
    incidentIds: [pantryIncidentId],
    capabilities: ["read", "simulate", "propose"],
  },
]);
const connection = await connectBoundedMcp({
  authorityConfigPath: configPath,
  credential: tokens.actor_agent!,
});
try {
  const tools = await connection.client.listTools();
  const incident = toolResultValue(
    await connection.client.callTool({
      name: "get_incident",
      arguments: {
        organizationId: pantryOrganizationId,
        incidentId: pantryIncidentId,
      },
    }),
  );
  const simulation = toolResultValue(
    await connection.client.callTool({
      name: "simulate_containment",
      arguments: {
        organizationId: pantryOrganizationId,
        incidentId: pantryIncidentId,
        overrides: {
          scheduler: {
            availability: "unsatisfied",
            securityTrust: "untrusted",
            freshness: "fresh",
            reason: "synthetic containment simulation",
          },
        },
      },
    }),
  );
  const simulationNodes = Object.keys(
    simulation.evaluations ?? simulation.nodeStates ?? {},
  ).length;
  if (simulationNodes < 1)
    throw new Error("simulation returned no node evaluations");
  process.stdout.write(
    `${JSON.stringify({ ok: true, protocolVersion: connection.protocolVersion, protocolEra: connection.protocolEra, toolNames: tools.tools.map((t) => t.name), incidentId: incident.id, simulationNodes, root }, null, 2)}\n`,
  );
} finally {
  await connection.close();
}
