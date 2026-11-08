import { randomUUID } from "node:crypto";
import type { CompanyNode, Member } from "./types.ts";

export type ImportFormat = "employees_csv" | "systems_csv" | "catalog_json";
export type ImportPreview = {
  previewId: string;
  format: ImportFormat;
  rows: Array<Record<string, unknown>>;
  errors: string[];
  warnings: string[];
  summary: { valid: number; invalid: number; boundedAt: number };
  createdAt: string;
};

const MAX_BYTES = 128 * 1024;
const MAX_ROWS = 250;
const safeId = (value: string) => /^[a-z][a-z0-9-]{1,99}$/.test(value);

function csv(content: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]!;
    if (quoted && char === '"' && content[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && content[i + 1] === "\n") i += 1;
      row.push(value);
      value = "";
      if (row.some(Boolean)) result.push(row);
      row = [];
    } else value += char;
  }
  if (quoted) throw new Error("unterminated CSV quote");
  row.push(value);
  if (row.some(Boolean)) result.push(row);
  return result;
}

export class ImportService {
  readonly #previews = new Map<string, ImportPreview>();
  preview(format: ImportFormat, content: string): ImportPreview {
    this.#prune();
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw new Error("import exceeds 128 KiB");
    const errors: string[] = [],
      warnings: string[] = [];
    let rows: Array<Record<string, unknown>> = [];
    if (format === "catalog_json") rows = this.#catalog(content, errors);
    else {
      const parsed = csv(content);
      if (!parsed.length) errors.push("file is empty");
      const header = parsed.shift()?.map((v) => v.trim()) ?? [];
      if (new Set(header).size !== header.length)
        errors.push("duplicate CSV header");
      rows = parsed
        .slice(0, MAX_ROWS)
        .map((values, index) =>
          Object.fromEntries(
            header.map((key, column) => [key, (values[column] ?? "").trim()]),
          ),
        );
      if (parsed.length > MAX_ROWS) errors.push(`row limit is ${MAX_ROWS}`);
      rows.forEach((row, index) => {
        if (!safeId(String(row.id ?? "")))
          errors.push(`row ${index + 2}: invalid id`);
        if (
          format === "employees_csv" &&
          (!row.name || !row.email || !row.departmentId || !row.title)
        )
          errors.push(`row ${index + 2}: required employee field missing`);
        if (
          format === "systems_csv" &&
          (!row.name || !row.kind || !row.description || !row.regionId)
        )
          errors.push(`row ${index + 2}: required system field missing`);
        for (const value of Object.values(row))
          if (typeof value === "string" && /^[=+@-]/.test(value))
            warnings.push(
              `row ${index + 2}: spreadsheet formula prefix treated as plain text`,
            );
      });
    }
    const preview: ImportPreview = {
      previewId: `preview-${randomUUID()}`,
      format,
      rows,
      errors: [...new Set(errors)].slice(0, 100),
      warnings: [...new Set(warnings)].slice(0, 100),
      summary: {
        valid: errors.length
          ? Math.max(0, rows.length - errors.length)
          : rows.length,
        invalid: errors.length,
        boundedAt: MAX_ROWS,
      },
      createdAt: new Date().toISOString(),
    };
    this.#previews.set(preview.previewId, preview);
    while (this.#previews.size > 20)
      this.#previews.delete(this.#previews.keys().next().value as string);
    return preview;
  }
  consume(previewId: string): ImportPreview {
    this.#prune();
    const preview = this.#previews.get(previewId);
    if (!preview) throw new Error("preview not found or expired");
    if (preview.errors.length)
      throw new Error("preview contains validation errors");
    this.#previews.delete(previewId);
    return preview;
  }
  #prune(): void {
    const cutoff = Date.now() - 15 * 60_000;
    for (const [id, preview] of this.#previews)
      if (new Date(preview.createdAt).getTime() < cutoff)
        this.#previews.delete(id);
  }
  #catalog(content: string, errors: string[]): Array<Record<string, unknown>> {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      errors.push("invalid JSON");
      return [];
    }
    const items = Array.isArray(value)
      ? value
      : value &&
          typeof value === "object" &&
          Array.isArray((value as { items?: unknown }).items)
        ? (value as { items: unknown[] }).items
        : [];
    if (items.length > MAX_ROWS) errors.push(`row limit is ${MAX_ROWS}`);
    return items.slice(0, MAX_ROWS).map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`item ${index + 1}: invalid entity`);
        return {};
      }
      const entity = item as Record<string, any>;
      const name = String(entity.metadata?.name ?? "");
      const type = String(entity.spec?.type ?? "service");
      if (!safeId(name))
        errors.push(`item ${index + 1}: invalid metadata.name`);
      if (entity.spec?.owner && typeof entity.spec.owner !== "string")
        errors.push(`item ${index + 1}: invalid owner`);
      const dependencies = Array.isArray(entity.spec?.dependsOn)
        ? entity.spec.dependsOn
            .filter((item: unknown) => typeof item === "string")
            .slice(0, 20)
            .map((item: string) =>
              item.replace(/^(?:component|resource|system):(?:[^/]+\/)?/, ""),
            )
        : [];
      return {
        id: name,
        name: String(entity.metadata?.title ?? name),
        kind: [
          "service",
          "component",
          "resource",
          "workflow",
          "dataset",
        ].includes(type)
          ? type
          : "service",
        description: String(
          entity.metadata?.description ?? "Imported catalog entity",
        ),
        regionId: String(
          entity.metadata?.annotations?.["tether.io/region"] ?? "global",
        ),
        ownerId:
          typeof entity.spec?.owner === "string"
            ? entity.spec.owner.replace(/^user:/, "")
            : undefined,
        dependencies,
        criticality: "medium",
        x: 100 + (index % 8) * 240,
        y: 100 + Math.floor(index / 8) * 180,
        source: "backstage-catalog",
      };
    });
  }
}

export function employeeFromImport(
  row: Record<string, unknown>,
): Omit<Member, "revision"> {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    departmentId: String(row.departmentId),
    team: String(row.team ?? row.departmentId),
    jobFamily: String(row.jobFamily ?? row.title),
    level: String(row.level ?? "IC2"),
    title: String(row.title),
    roleTemplate: "member",
    ...(row.managerId ? { managerId: String(row.managerId) } : {}),
    active: String(row.active ?? "true") !== "false",
    loginProvisioned: false,
    timezone: String(row.timezone ?? "America/Chicago"),
    workingHours: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      start: "09:00",
      end: "17:00",
    })),
    availability: "available",
    notifications: {
      routineInHours: true,
      afterHours: false,
      channels: ["in_app"],
      severities: ["high", "critical"],
    },
    onCallWindows: [],
  };
}
export function nodeFromImport(
  row: Record<string, unknown>,
): Omit<CompanyNode, "semanticRevision" | "layoutRevision"> {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind) as CompanyNode["kind"],
    description: String(row.description),
    regionId: String(row.regionId ?? "global"),
    ...(row.ownerId ? { ownerId: String(row.ownerId) } : {}),
    criticality: String(
      row.criticality ?? "medium",
    ) as CompanyNode["criticality"],
    status: "healthy",
    x: Number(row.x ?? 100),
    y: Number(row.y ?? 100),
  };
}
