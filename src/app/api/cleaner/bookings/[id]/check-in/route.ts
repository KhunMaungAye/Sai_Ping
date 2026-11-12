import { requireRole } from "../../../../../../lib/auth.ts";
import { checkInForVisit } from "../../../../../../lib/booking-store.ts";
import { visitResponse } from "../../../../../../lib/visit-response.ts";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["cleaner"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  const { id } = await params;
  const cleanerId = auth.user.cleanerId || auth.user.id;
  try {
    return visitResponse(checkInForVisit(id, cleanerId), "Checked in. Have a good clean!");
  } catch {
    return Response.json(
      { error: "Could not check in. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
