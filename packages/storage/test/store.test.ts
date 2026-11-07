import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Incident } from "../../contracts/src/index.ts";
import {
  CanonicalStore,
  RevisionConflictError,
  ScopeMismatchError,
} from "../src/index.ts";

const incident: Incident = {
  schemaVersion: 1,
  organizationId: "org_a",
  id: "incident_a",
  title: "Synthetic incident",
  status: "open",
  affectedNodeIds: [],
  evidenceIds: [],
  commanderActorId: "commander",
  revision: 1,
  createdAt: "2026-11-07T08:00:00.000Z",
  updatedAt: "2026-11-07T08:00:00.000Z",
};
const event = {
  schemaVersion: 1 as const,
  id: "event_a",
  organizationId: "org_a",
  incidentId: "incident_a",
  aggregateType: "incident" as const,
  aggregateId: "incident_a",
  aggregateRevision: 1,
  eventType: "IncidentOpened",
  payload: {},
  occurredAt: "2026-11-07T08:00:00.000Z",
};

test("canonical state, outbox, and consumer dedup survive restart", () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "continuity-store-")),
    "store.db",
  );
  const first = new CanonicalStore(path);
  first.save(
    { recordType: "incident", value: incident },
    { expectedRevision: null, event },
  );
  assert.equal(first.pendingOutbox().length, 1);
  assert.equal(
    first.acceptEventOnce("consumer", event.id, event.occurredAt),
    true,
  );
  assert.equal(
    first.acceptEventOnce("consumer", event.id, event.occurredAt),
    false,
  );
  first.close();

  const restarted = new CanonicalStore(path);
  assert.deepEqual(
    restarted.get("org_a", "incident_a", "incident", "incident_a")?.value,
    incident,
  );
  assert.equal(
    restarted.get("org_b", "incident_a", "incident", "incident_a"),
    undefined,
  );
  assert.equal(restarted.pendingOutbox()[0]?.attempts, 0);
  restarted.markOutboxAttempt(event.id, null);
  assert.equal(restarted.pendingOutbox()[0]?.attempts, 1);
  restarted.markOutboxAttempt(event.id, "2026-11-07T08:01:00.000Z");
  assert.equal(restarted.pendingOutbox().length, 0);
  restarted.close();
});

test("optimistic revisions and event dedup reject stale writes", () => {
  const store = new CanonicalStore();
  store.save(
    { recordType: "incident", value: incident },
    { expectedRevision: null, event },
  );
  assert.throws(
    () =>
      store.save(
        { recordType: "incident", value: incident },
        { expectedRevision: null, event },
      ),
    RevisionConflictError,
  );
  store.close();
});

test("event scope and aggregate type are bound to the canonical record", () => {
  const store = new CanonicalStore();
  assert.throws(
    () =>
      store.save(
        { recordType: "incident", value: incident },
        {
          expectedRevision: null,
          event: { ...event, incidentId: "incident_other" },
        },
      ),
    ScopeMismatchError,
  );
  assert.throws(
    () =>
      store.save(
        { recordType: "incident", value: incident },
        {
          expectedRevision: null,
          event: { ...event, aggregateType: "proposal" },
        },
      ),
    ScopeMismatchError,
  );
  assert.equal(
    store.get("org_a", "incident_a", "incident", "incident_a"),
    undefined,
  );
  store.close();
});

test("multi-record mutation rolls back canonical rows, events, and outbox together", () => {
  const store = new CanonicalStore();
  store.save(
    { recordType: "incident", value: incident },
    { expectedRevision: null, event },
  );
  const updated: Incident = {
    ...incident,
    revision: 2,
    title: "Updated atomically",
    updatedAt: "2026-11-07T08:01:00.000Z",
  };
  const second: Incident = {
    ...incident,
    id: "incident_b",
    title: "Second",
    commanderActorId: "commander",
    revision: 1,
  };
  assert.throws(() =>
    store.saveMany([
      {
        record: { recordType: "incident", value: updated },
        options: {
          expectedRevision: 1,
          event: {
            ...event,
            id: "event_update",
            aggregateRevision: 2,
            eventType: "IncidentUpdated",
          },
        },
      },
      {
        record: { recordType: "incident", value: second },
        options: {
          expectedRevision: null,
          event: {
            ...event,
            id: "event_update",
            incidentId: second.id,
            aggregateId: second.id,
            eventType: "IncidentOpened",
          },
        },
      },
    ]),
  );
  assert.equal(
    store.get("org_a", "incident_a", "incident", "incident_a")?.value.revision,
    1,
  );
  assert.equal(
    store.get("org_a", "incident_b", "incident", "incident_b"),
    undefined,
  );
  assert.equal(store.pendingOutbox().length, 1);
  store.close();
});
