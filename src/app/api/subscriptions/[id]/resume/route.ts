import { resumeSubscription } from "../../../../../lib/booking-store.ts";
import { handlePlanChange } from "../plan-change.ts";

type RouteContext = { params: Promise<{ id: string }> };

/** US-15: end a pause early and put paused visits back where possible. */
export async function POST(request: Request, { params }: RouteContext) {
  return handlePlanChange(request, params, (id, email) => resumeSubscription(id, email));
}
