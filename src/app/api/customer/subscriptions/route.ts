import { requireRole } from "../../../../lib/auth.ts";
import { listCustomerSubscriptions } from "../../../../lib/booking-store.ts";

/** US-15: the signed-in customer's recurring plans. */
export async function GET(request: Request) {
  const auth = requireRole(request, ["customer"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  return Response.json(
    { subscriptions: listCustomerSubscriptions(auth.user.email) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
