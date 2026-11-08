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

test("presence follows local hours, accepted on-call coverage, leave and expiring user choices", async () => {
  const { effectiveAvailability } = await import("./scheduling.ts");
  const member = {
    ...seedMembers()[0]!,
    timezone: "UTC",
    workingHours: [{ weekday: 1, start: "09:00", end: "17:00" }],
    availability: "available" as const,
    onCallWindows: [],
  };
  assert.equal(
    effectiveAvailability(member, new Date("2026-11-09T10:00:00Z")),
    "available",
  );
  assert.equal(
    effectiveAvailability(member, new Date("2026-11-09T20:00:00Z")),
    "off_hours",
  );
  assert.equal(
    effectiveAvailability(
      { ...member, availability: "on_call" },
      new Date("2026-11-09T20:00:00Z"),
    ),
    "off_hours",
  );
  const onCall = {
    ...member,
    onCallWindows: [
      {
        startsAt: "2026-11-09T18:00:00Z",
        endsAt: "2026-11-09T22:00:00Z",
        accepted: true,
      },
    ],
  };
  assert.equal(
    effectiveAvailability(onCall, new Date("2026-11-09T20:00:00Z")),
    "on_call",
  );
  assert.equal(
    effectiveAvailability(
      { ...onCall, availability: "away" },
      new Date("2026-11-09T20:00:00Z"),
    ),
    "away",
  );
  assert.equal(
    effectiveAvailability(
      {
        ...member,
        availability: "meeting",
        availabilityUntil: "2026-11-09T09:30:00Z",
      },
      new Date("2026-11-09T10:00:00Z"),
    ),
    "available",
  );
  assert.equal(
    effectiveAvailability(
      {
        ...onCall,
        leave: {
          startsAt: "2026-11-09T18:00:00Z",
          endsAt: "2026-11-09T22:00:00Z",
          reason: "leave",
        },
      },
      new Date("2026-11-09T20:00:00Z"),
    ),
    "away",
  );
});
