import assert from "node:assert/strict";
import test from "node:test";
import { ImportService } from "./imports.ts";

test("employee CSV preview treats formulas as text and cannot create authority", () => {
  const service = new ImportService();
  const preview = service.preview(
    "employees_csv",
    "id,name,email,departmentId,title,role\nemployee-new,New Person,new@northstar.example,engineering,Principal Engineer,senior_manager\n",
  );
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0]?.role, "senior_manager");
  assert.ok(!("capabilities" in preview.rows[0]!));
  assert.deepEqual(service.consume(preview.previewId).rows, preview.rows);
});
test("Backstage catalog JSON stays bounded and rejects remote behavior", () => {
  const service = new ImportService();
  const preview = service.preview(
    "catalog_json",
    JSON.stringify({
      items: [
        {
          apiVersion: "backstage.io/v1alpha1",
          kind: "Component",
          metadata: {
            name: "training-api",
            description: "Training entrypoint",
            annotations: {
              "tether.io/region": "dfw",
              "backstage.io/source-location": "url:https://evil.example",
            },
          },
          spec: { type: "service", owner: "user:employee-priya" },
        },
      ],
    }),
  );
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.rows[0]?.id, "training-api");
  assert.equal(preview.rows[0]?.ownerId, "employee-priya");
  assert.ok(!JSON.stringify(preview.rows[0]).includes("evil.example"));
});

test("malformed employee fields are counted by record and previews cannot be altered", async () => {
  const { TetherCompanyStore } = await import("./company.ts");
  const company = new TetherCompanyStore();
  try {
    const service = new ImportService(() => company.allState());
    const preview = service.preview(
      "employees_csv",
      "id,name,email,departmentId,title,team,timezone\nreview-five-invalid,Invalid Review,invalid,missing-dept,Engineer,Review,NotATimezone\n",
    );
    assert.equal(preview.summary.invalid, 1);
    assert.equal(preview.summary.valid, 0);
    for (const field of ["email", "departmentId", "timezone"])
      assert.ok(preview.errors.some((error) => error.includes(field)));
    preview.errors.length = 0;
    preview.rows[0]!.timezone = "UTC";
    assert.throws(
      () => service.consume(preview.previewId),
      /validation errors/,
    );
    const valid = service.preview(
      "employees_csv",
      "id,name,email,departmentId,title\nnew-person,New Person,new.person@example.com,engineering,Director\n",
    );
    valid.rows[0]!.email = "invalid";
    assert.equal(
      service.consume(valid.previewId).rows[0]!.email,
      "new.person@example.com",
    );
    assert.throws(
      () =>
        company.addMember({
          ...company.member("employee-noah")!,
          id: "invalid-member",
          email: "invalid",
          timezone: "UTC",
        }),
      /email/,
    );
    const member = company.member("employee-noah")!;
    for (const patch of [
      { departmentId: "missing-dept" },
      { timezone: "" },
      { timezone: "NotATimezone" },
    ])
      assert.throws(() =>
        company.updateMember(member.id, member.revision, patch),
      );
    assert.equal(company.member(member.id)!.revision, member.revision);
  } finally {
    company.close();
  }
});

test("duplicates and stale owner references fail before any commit", async () => {
  const { TetherCompanyStore } = await import("./company.ts");
  const company = new TetherCompanyStore();
  try {
    const service = new ImportService(() => company.allState());
    const duplicate = service.preview(
      "employees_csv",
      "id,name,email,departmentId,title\nnew-person,Person,new@example.com,engineering,Engineer\nnew-person,Person,new@example.com,engineering,Engineer",
    );
    assert.ok(duplicate.errors.some((error) => error.includes("duplicate id")));
    assert.throws(() => service.consume(duplicate.previewId));
    const system = service.preview(
      "systems_csv",
      "id,name,kind,description,regionId,ownerId\nnew-system,New System,service,New service,global,employee-noah",
    );
    assert.deepEqual(system.errors, []);
    const owner = company.member("employee-noah")!;
    company.updateMember(owner.id, owner.revision, { active: false });
    assert.throws(() => service.consume(system.previewId), /ownerId/);
  } finally {
    company.close();
  }
});

test("HTTP rejects malformed mixed CSV without partial writes and accepts corrected records without authority", async (t) => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const { startTetherServer } = await import("./server.ts");
  const runtimeDir = await mkdtemp(join(tmpdir(), "tether-import-regression-"));
  const app = await startTetherServer({ port: 0, runtimeDir });
  t.after(async () => {
    await app.close();
    await rm(runtimeDir, { recursive: true, force: true });
  });
  const accounts = JSON.parse(
    await readFile(join(runtimeDir, "bootstrap-accounts.json"), "utf8"),
  ).accounts;
  const admin = accounts.find(
    (account: any) => account.employeeId === "employee-ava",
  );
  let token = "";
  async function request(path: string, body?: unknown) {
    const response = await fetch(`${app.url}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: app.url,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  token = (
    await request("/api/login", {
      email: admin.login,
      password: admin.password,
    })
  ).body.token;
  const action = (type: string, payload: unknown) =>
    request("/api/actions", { type, payload, idempotencyKey: randomUUID() });
  const before = (await request("/api/state")).body;
  const header = "id,name,email,departmentId,title,team,timezone,role\n";
  const good =
    "review-five-valid,Valid Review,valid.review@example.com,engineering,Director,Review,UTC,senior_manager\n";
  const bad =
    "review-five-invalid,Invalid Review,invalid,missing-dept,Engineer,Review,NotATimezone,member\n";
  const preview = await action("import.preview", {
    format: "employees_csv",
    content: header + good + bad,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.result.summary.valid, 1);
  assert.equal(preview.body.result.summary.invalid, 1);
  const denied = await action("import.commit", {
    previewId: preview.body.result.previewId,
    semanticRevision: before.organization.semanticRevision,
    rows: [],
    errors: [],
  });
  assert.ok(denied.status >= 400);
  const after = (await request("/api/state")).body;
  assert.equal(after.members.length, before.members.length);
  assert.ok(
    !after.members.some((member: any) => member.id.startsWith("review-five-")),
  );
  const valid = await action("import.preview", {
    format: "employees_csv",
    content: header + good,
  });
  assert.deepEqual(valid.body.result.errors, []);
  const committed = await action("import.commit", {
    previewId: valid.body.result.previewId,
    semanticRevision: before.organization.semanticRevision,
  });
  assert.equal(committed.status, 200);
  const member = committed.body.state.members.find(
    (member: any) => member.id === "review-five-valid",
  );
  assert.equal(member.roleTemplate, "member");
  assert.equal(member.loginProvisioned, false);
  await t.test(
    "retained inactive owner blocks mixed system batches before writes, including stale previews",
    async () => {
      const created = await action("node.create", {
        name: "Retained owner service",
        kind: "service",
        description: "Existing owned service",
        regionId: "global",
        ownerId: "employee-noah",
        criticality: "medium",
        x: 10,
        y: 10,
      });
      assert.equal(created.status, 200);
      const existingId = created.body.result.id;
      const content =
        "id,name,kind,description,regionId\n" +
        "preflight-new-system,First valid system,service,Must never be written,global\n" +
        `${existingId},Updated service,service,Owner intentionally omitted,global\n`;
      const stalePreview = await action("import.preview", {
        format: "systems_csv",
        content,
      });
      assert.deepEqual(stalePreview.body.result.errors, []);
      const state = (await request("/api/state")).body;
      const owner = state.members.find(
        (member: any) => member.id === "employee-noah",
      );
      const deactivated = await action("member.update", {
        id: owner.id,
        revision: owner.revision,
        patch: { active: false },
      });
      assert.equal(deactivated.status, 200);
      const beforeSystems = (await request("/api/state")).body;
      const invalidPreview = await action("import.preview", {
        format: "systems_csv",
        content,
      });
      assert.equal(invalidPreview.status, 200);
      assert.equal(invalidPreview.body.result.summary.invalid, 1);
      assert.ok(
        invalidPreview.body.result.errors.some((error: string) =>
          error.includes("ownerId"),
        ),
      );
      for (const preview of [invalidPreview, stalePreview]) {
        const rejected = await action("import.commit", {
          previewId: preview.body.result.previewId,
          semanticRevision: beforeSystems.organization.semanticRevision,
        });
        assert.ok(rejected.status >= 400);
        const afterSystems = (await request("/api/state")).body;
        assert.equal(afterSystems.nodes.length, beforeSystems.nodes.length);
        assert.ok(
          !afterSystems.nodes.some(
            (node: any) => node.id === "preflight-new-system",
          ),
        );
        assert.deepEqual(
          afterSystems.nodes.find((node: any) => node.id === existingId),
          beforeSystems.nodes.find((node: any) => node.id === existingId),
        );
      }
    },
  );
});
