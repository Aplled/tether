import assert from "node:assert/strict";
import test from "node:test";
import { TetherCompanyStore } from "./company.ts";
import { briefIsStale, generateTaskBrief } from "./handoffs.ts";

test("task brief is bounded to source paths and becomes stale on task change", () => {
  const store = new TetherCompanyStore();
  const incident = store.createIncident({
    title: "Retry issue",
    observation: "Cross-tenant retry was observed.",
    regionId: "dfw",
    nodeIds: ["retry-route"],
    memberIds: ["employee-noah"],
    commanderId: "employee-ava",
  });
  const task = store.createTask({
    incidentId: incident.id,
    title: "Investigate retry authorization",
    ownerId: "employee-noah",
    nodeIds: ["retry-route"],
  });
  const state = store.allState();
  const brief = generateTaskBrief({
    state,
    task,
    assignee: store.member("employee-noah")!,
    permittedPaths: ["fixtures/northstar/retry-service.ts", "../../secret"],
    evidence: [incident.observation],
    unknowns: ["Exact cause unverified"],
    tests: ["node --test fixtures/northstar/retry-service.test.ts"],
    acceptanceCriteria: ["Cross-tenant retry denied"],
  });
  assert.match(brief.text, /fixtures\/northstar\/retry-service\.ts/);
  assert.doesNotMatch(brief.text, /secret/);
  assert.equal(briefIsStale(brief, state, task), false);
  const changed = store.updateTask(task.id, 1, "investigating");
  assert.equal(briefIsStale(brief, store.allState(), changed), true);
  store.close();
});
