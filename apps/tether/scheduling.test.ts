import assert from "node:assert/strict";
import test from "node:test";
import { chooseEscalation, isInWorkingWindow } from "./scheduling.ts";
import { seedMembers } from "./seed.ts";

test("overnight hours include the following weekday and not unrelated early hours", () => {
  const member = {
    ...seedMembers()[0]!,
    workingHours: [{ weekday: 1, start: "22:00", end: "06:00" }],
  };
  assert.equal(
    isInWorkingWindow(member, new Date("2026-11-03T05:00:00Z")),
    true,
  );
  assert.equal(
    isInWorkingWindow(member, new Date("2026-11-04T05:00:00Z")),
    false,
  );
});
test("escalation never promotes an unauthorized manager or overrides opt-out", () => {
  const members = seedMembers();
  const incident = {
    id: "incident-a",
    title: "Retry issue",
    observation: "Unknown",
    status: "open" as const,
    regionId: "dfw",
    nodeIds: ["retry-route"],
    memberIds: ["employee-ava", "employee-priya"],
    commanderId: "employee-ava",
    evidenceRevision: 1,
    revision: 1,
    createdAt: "2026-11-08T00:00:00Z",
    updatedAt: "2026-11-08T00:00:00Z",
  };
  const result = chooseEscalation({
    incident,
    members,
    delegates: [
      {
        id: "d",
        fromId: "employee-ava",
        toId: "employee-priya",
        startsAt: "2026-11-08T00:00:00Z",
        endsAt: "2026-11-09T00:00:00Z",
        capabilities: ["incident:approve"],
        resourceIds: [incident.id],
      },
    ],
    authorizedApproverIds: new Set(),
    at: new Date("2026-11-08T04:00:00Z"),
  });
  assert.equal(result.approvalBlocked, true);
  assert.ok(
    result.candidates.every((c) =>
      c.reasons.includes("no existing approval permission"),
    ),
  );
});
