import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_MCP_TOOLS, createCompanyMcpSession } from "./mcp.ts";

test("company tools negotiate modern MCP and read changed canonical state", async () => {
  let revision = 1,
    authorized = true;
  const session = await createCompanyMcpSession({
    organizationId: "northstar",
    incidentId: "incident-a",
    invoke: async (name, args) => {
      if (!authorized) throw new Error("revoked");
      assert.equal(args.organizationId, "northstar");
      assert.equal(args.incidentId, "incident-a");
      return { name, revision };
    },
  });
  try {
    assert.equal(session.protocolVersion, "2026-07-28");
    assert.deepEqual([...session.tools].sort(), [...COMPANY_MCP_TOOLS].sort());
    assert.deepEqual(await session.callTool("get_dependencies", {}), {
      name: "get_dependencies",
      revision: 1,
    });
    revision = 2;
    assert.deepEqual(await session.callTool("get_dependencies", {}), {
      name: "get_dependencies",
      revision: 2,
    });
    authorized = false;
    await assert.rejects(session.callTool("get_dependencies", {}), /rejected/);
    await assert.rejects(
      session.callTool("submit_response_proposal", {}),
      /not allowed/,
    );
  } finally {
    await session.close();
  }
});

test("company MCP enforces the shared six-call budget", async () => {
  const session = await createCompanyMcpSession({
    organizationId: "northstar",
    incidentId: "incident-a",
    invoke: async () => ({ ok: true }),
  });
  try {
    for (let i = 0; i < 6; i += 1)
      assert.deepEqual(await session.callTool("get_incident", {}), {
        ok: true,
      });
    await assert.rejects(session.callTool("get_incident", {}), /budget/);
  } finally {
    await session.close();
  }
});
