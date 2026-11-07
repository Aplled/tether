import { randomUUID } from "node:crypto";
import { z } from "zod";

export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
export type Id = z.infer<typeof IdSchema>;

export function newId(prefix: string): Id {
  return `${prefix}_${randomUUID()}`;
}
