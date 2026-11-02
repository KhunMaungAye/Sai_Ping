import { requireRole } from "../../../../lib/auth.ts";
import type { SubscriptionChangeResult } from "../../../../lib/booking-store.ts";

const STATUS_CODES = { "not-found": 404, invalid: 400, conflict: 409 } as const;

/**
 * Shared wrapper for the US-15 skip / pause / resume routes: only the
 * customer who owns the plan may change it.
 */
export async function handlePlanChange(
  request: Request,
  params: Promise<{ id: string }>,
  change: (
    subscriptionId: string,
    customerEmail: string,
    body: Record<string, unknown>,
  ) => SubscriptionChangeResult,
) {
  const auth = requireRole(request, ["customer"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // An empty body is fine for routes that need no fields (resume).
  }

  const { id } = await params;
  const result = change(id, auth.user.email, body);
  if (result.status !== "ok") {
    return Response.json(
      { error: result.error },
      { status: STATUS_CODES[result.status], headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { message: result.message, subscription: result.subscription, dates: result.dates },
    { headers: { "Cache-Control": "no-store" } },
  );
}
