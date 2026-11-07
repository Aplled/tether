import { DatabaseSync } from "node:sqlite";
import {
  DomainEventSchema,
  OutboxEntrySchema,
  StoredRecordSchema,
  type DomainEvent,
  type OutboxEntry,
  type StoredRecord,
  type StoredRecordType,
} from "../../contracts/src/index.ts";

export class RevisionConflictError extends Error {
  readonly code = "revision_conflict";
}

export class ScopeMismatchError extends Error {
  readonly code = "scope_mismatch";
}

export type SaveOptions = {
  expectedRevision: number | null;
  event: DomainEvent;
};
export type SaveEntry = { record: StoredRecord; options: SaveOptions };

export class CanonicalStore {
  readonly #db: DatabaseSync;

  constructor(path = ":memory:") {
    this.#db = new DatabaseSync(path);
    this.#db.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
    );
    this.#migrate();
  }

  close(): void {
    this.#db.close();
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS canonical_records (
        organization_id TEXT NOT NULL,
        incident_id TEXT NOT NULL DEFAULT '',
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        body_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, incident_id, record_type, record_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS domain_events (
        event_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_revision INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        body_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (organization_id, incident_id, aggregate_type, aggregate_id, aggregate_revision)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS outbox (
        event_id TEXT PRIMARY KEY REFERENCES domain_events(event_id),
        delivered_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS processed_events (
        consumer_id TEXT NOT NULL,
        event_id TEXT NOT NULL REFERENCES domain_events(event_id),
        processed_at TEXT NOT NULL,
        PRIMARY KEY (consumer_id, event_id)
      ) STRICT;
    `);
  }

  save(recordInput: StoredRecord, options: SaveOptions): void {
    this.saveMany([{ record: recordInput, options }]);
  }

  saveMany(entriesInput: SaveEntry[]): void {
    if (entriesInput.length < 1 || entriesInput.length > 100)
      throw new RangeError("saveMany requires 1..100 entries");
    const aggregateByRecord: Record<
      StoredRecordType,
      DomainEvent["aggregateType"]
    > = {
      actor: "actor",
      node: "node",
      dependency_group: "dependency_group",
      incident: "incident",
      proposal: "proposal",
      task: "task",
      fallback: "fallback",
      evidence: "evidence",
    };
    const entries = entriesInput.map((entry) => {
      const record = StoredRecordSchema.parse(entry.record);
      const event = DomainEventSchema.parse(entry.options.event);
      const value = record.value;
      const incidentId =
        "incidentId" in value
          ? value.incidentId
          : record.recordType === "incident"
            ? value.id
            : "";
      const expectedEventIncidentId =
        incidentId || `configuration:${value.organizationId}`;
      if (
        event.organizationId !== value.organizationId ||
        event.incidentId !== expectedEventIncidentId
      ) {
        throw new ScopeMismatchError("event and record scopes differ");
      }
      if (event.aggregateType !== aggregateByRecord[record.recordType]) {
        throw new ScopeMismatchError(
          "event aggregate type differs from record type",
        );
      }
      if (
        event.aggregateId !== value.id ||
        event.aggregateRevision !== value.revision
      ) {
        throw new RevisionConflictError(
          "event aggregate identity/revision differs from record",
        );
      }
      return {
        record,
        event,
        value,
        incidentId,
        expectedRevision: entry.options.expectedRevision,
      };
    });
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        const { record, event, value, incidentId, expectedRevision } = entry;
        const current = this.#db
          .prepare(
            `
          SELECT revision FROM canonical_records
          WHERE organization_id = ? AND incident_id = ? AND record_type = ? AND record_id = ?
        `,
          )
          .get(
            value.organizationId,
            incidentId,
            record.recordType,
            value.id,
          ) as { revision: number } | undefined;
        const actualRevision = current?.revision ?? null;
        if (actualRevision !== expectedRevision) {
          throw new RevisionConflictError(
            `expected ${String(expectedRevision)}, got ${String(actualRevision)}`,
          );
        }
        if (value.revision !== (actualRevision ?? 0) + 1) {
          throw new RevisionConflictError(
            `new revision ${value.revision} must follow ${String(actualRevision)}`,
          );
        }
        const write = this.#db
          .prepare(
            `
          INSERT INTO canonical_records
            (organization_id, incident_id, record_type, record_id, revision, body_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (organization_id, incident_id, record_type, record_id)
          DO UPDATE SET revision = excluded.revision, body_json = excluded.body_json, updated_at = excluded.updated_at
          WHERE canonical_records.revision = ?
        `,
          )
          .run(
            value.organizationId,
            incidentId,
            record.recordType,
            value.id,
            value.revision,
            JSON.stringify(record),
            event.occurredAt,
            expectedRevision ?? -1,
          );
        if (write.changes !== 1)
          throw new RevisionConflictError(
            "compare-and-swap write did not change one record",
          );
        this.#db
          .prepare(
            `
          INSERT INTO domain_events
            (event_id, organization_id, incident_id, aggregate_type, aggregate_id, aggregate_revision, event_type, body_json, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            event.id,
            event.organizationId,
            event.incidentId,
            event.aggregateType,
            event.aggregateId,
            event.aggregateRevision,
            event.eventType,
            JSON.stringify(event),
            event.occurredAt,
          );
        this.#db
          .prepare("INSERT INTO outbox (event_id) VALUES (?)")
          .run(event.id);
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  get<T extends StoredRecordType>(
    organizationId: string,
    incidentId: string | null,
    recordType: T,
    id: string,
  ): Extract<StoredRecord, { recordType: T }> | undefined {
    const row = this.#db
      .prepare(
        `
      SELECT body_json FROM canonical_records
      WHERE organization_id = ? AND incident_id = ? AND record_type = ? AND record_id = ?
    `,
      )
      .get(organizationId, incidentId ?? "", recordType, id) as
      { body_json: string } | undefined;
    if (!row) return undefined;
    return StoredRecordSchema.parse(JSON.parse(row.body_json)) as Extract<
      StoredRecord,
      { recordType: T }
    >;
  }

  list<T extends StoredRecordType>(
    organizationId: string,
    incidentId: string | null,
    recordType: T,
  ): Array<Extract<StoredRecord, { recordType: T }>> {
    const rows = this.#db
      .prepare(
        `
      SELECT body_json FROM canonical_records
      WHERE organization_id = ? AND incident_id = ? AND record_type = ? ORDER BY record_id
    `,
      )
      .all(organizationId, incidentId ?? "", recordType) as Array<{
      body_json: string;
    }>;
    return rows.map(
      (row) =>
        StoredRecordSchema.parse(JSON.parse(row.body_json)) as Extract<
          StoredRecord,
          { recordType: T }
        >,
    );
  }

  listEvents(organizationId: string, incidentId: string): DomainEvent[] {
    const rows = this.#db
      .prepare(
        `
      SELECT body_json FROM domain_events
      WHERE organization_id = ? AND incident_id = ? ORDER BY rowid
    `,
      )
      .all(organizationId, incidentId) as Array<{ body_json: string }>;
    return rows.map((row) =>
      DomainEventSchema.parse(JSON.parse(row.body_json)),
    );
  }

  pendingOutbox(limit = 100): OutboxEntry[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new RangeError("limit must be 1..1000");
    const rows = this.#db
      .prepare(
        `
      SELECT e.body_json, o.delivered_at, o.attempts
      FROM outbox o JOIN domain_events e ON e.event_id = o.event_id
      WHERE o.delivered_at IS NULL ORDER BY e.rowid LIMIT ?
    `,
      )
      .all(limit) as Array<{
      body_json: string;
      delivered_at: string | null;
      attempts: number;
    }>;
    return rows.map((row) =>
      OutboxEntrySchema.parse({
        event: JSON.parse(row.body_json),
        deliveredAt: row.delivered_at,
        attempts: row.attempts,
      }),
    );
  }

  markOutboxAttempt(eventId: string, deliveredAt: string | null): void {
    const result = this.#db
      .prepare(
        `
      UPDATE outbox SET attempts = attempts + 1, delivered_at = COALESCE(?, delivered_at) WHERE event_id = ?
    `,
      )
      .run(deliveredAt, eventId);
    if (result.changes !== 1) throw new Error(`unknown_event:${eventId}`);
  }

  acceptEventOnce(
    consumerId: string,
    eventId: string,
    processedAt: string,
  ): boolean {
    const result = this.#db
      .prepare(
        `
      INSERT OR IGNORE INTO processed_events (consumer_id, event_id, processed_at) VALUES (?, ?, ?)
    `,
      )
      .run(consumerId, eventId, processedAt);
    return result.changes === 1;
  }
}
