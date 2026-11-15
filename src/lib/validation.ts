import type { ZodType, z } from "zod";

/**
 * Parses a request body against a zod schema and returns either the typed,
 * validated data or the first validation error as a plain string — the same
 * shape every route already returns from `Response.json({ error }, { status: 400 })`.
 * Keeps route handlers declarative instead of hand-rolling `typeof x === "string"`
 * checks for every field.
 */
export function parseBody<T extends ZodType>(
  schema: T,
  body: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const firstIssue = result.error.issues[0];
  return { ok: false, error: firstIssue?.message || "Invalid request." };
}
