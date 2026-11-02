import { skipSubscriptionVisit } from "../../../../../lib/booking-store.ts";
import { handlePlanChange } from "../plan-change.ts";

type RouteContext = { params: Promise<{ id: string }> };

/** US-15: skip one upcoming visit. Body: { date: "YYYY-MM-DD", confirmAccepted?: true } */
export async function POST(request: Request, { params }: RouteContext) {
  return handlePlanChange(request, params, (id, email, body) =>
    skipSubscriptionVisit(
      id,
      email,
      typeof body.date === "string" ? body.date : "",
      body.confirmAccepted === true,
    ),
  );
}
