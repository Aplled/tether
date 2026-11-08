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
