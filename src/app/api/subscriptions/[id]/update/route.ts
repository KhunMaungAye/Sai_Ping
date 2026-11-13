import { updateSubscription } from "../../../../../lib/booking-store.ts";
import { parseSubscriptionChanges } from "../../../../../lib/subscription-changes.ts";
import { handlePlanChange } from "../plan-change.ts";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * US-04: change a recurring plan's frequency or details.
 * Body: any of { frequency, preferredDay, time, serviceId, address, specialInstructions },
 * plus confirmAccepted: true to go ahead when a cleaner already accepted a visit.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return handlePlanChange(request, params, (id, email, body) => {
    const parsed = parseSubscriptionChanges(body);
    if (!parsed.ok) return { status: "invalid", error: parsed.error };
    return updateSubscription(id, email, parsed.changes, body.confirmAccepted === true);
  });
}
