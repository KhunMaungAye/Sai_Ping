import { requireRole } from "../../../../../../lib/auth.ts";
import { reportRunningLate } from "../../../../../../lib/booking-store.ts";
import { visitResponse } from "../../../../../../lib/visit-response.ts";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/** US-09: the cleaner reports they'll be 15, 30 or 45 minutes late. */
export async function POST(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["cleaner"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400, headers: NO_STORE });
  }
  const minutes = (body as { minutes?: unknown } | null)?.minutes;
  const { id } = await params;
  const cleanerId = auth.user.cleanerId || auth.user.id;
  try {
    const result = reportRunningLate(id, cleanerId, typeof minutes === "number" ? minutes : NaN);
    return visitResponse(
      result,
      result.status === "ok" ? `Thanks. The admin knows you'll be ${minutes} minutes late.` : "",
    );
  } catch {
    return Response.json(
      { error: "Could not send your update. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
