import { requireRole } from "../../../../lib/auth.ts";
import { detectNoShows, getNoShowAlerts } from "../../../../lib/booking-store.ts";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * US-09: checks for new no-shows, then returns open alerts (with replacement
 * cleaners) and recently resolved ones. The admin dashboard calls this on
 * load and every minute, which is what makes the alert automatic.
 */
export async function GET(request: Request) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  try {
    const raised = detectNoShows();
    return Response.json({ raised, ...getNoShowAlerts() }, { headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "Could not load no-show alerts." },
      { status: 500, headers: NO_STORE },
    );
  }
}
