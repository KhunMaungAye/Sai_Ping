import { pauseSubscription } from "../../../../../lib/booking-store.ts";
import { handlePlanChange } from "../plan-change.ts";

type RouteContext = { params: Promise<{ id: string }> };

/** US-15: pause a plan until a resume date. Body: { resumeDate: "YYYY-MM-DD" } */
export async function POST(request: Request, { params }: RouteContext) {
  return handlePlanChange(request, params, (id, email, body) =>
    pauseSubscription(
      id,
      email,
      typeof body.resumeDate === "string" ? body.resumeDate : "",
    ),
  );
}
