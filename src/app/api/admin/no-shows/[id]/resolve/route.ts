import { requireRole } from "../../../../../../lib/auth.ts";
import { resolveNoShowAlert } from "../../../../../../lib/booking-store.ts";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * US-09: resolve a no-show alert.
 * Body: { "action": "reassign", "cleanerId": "..." } or { "action": "resolve" }.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  let body: { action?: unknown; cleanerId?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400, headers: NO_STORE });
  }

  let action: { type: "reassign"; cleanerId: string } | { type: "resolve" };
  if (body?.action === "resolve") {
    action = { type: "resolve" };
  } else if (body?.action === "reassign" && typeof body.cleanerId === "string" && body.cleanerId) {
    action = { type: "reassign", cleanerId: body.cleanerId };
  } else {
    return Response.json(
      { error: "Choose a cleaner to reassign the job to, or mark the alert resolved." },
      { status: 400, headers: NO_STORE },
    );
  }

  const { id } = await params;
  try {
    const result = resolveNoShowAlert(id, action, auth.user.name);
    switch (result.status) {
      case "ok":
        return Response.json(
          {
            success: true,
            ...result.alert,
            message:
              result.alert.resolution === "reassigned"
                ? `Job reassigned to ${result.alert.reassignedToName}. They have an hour to arrive.`
                : "Alert marked as resolved.",
          },
          { headers: NO_STORE },
        );
      case "not-found":
        return Response.json({ error: "Alert not found." }, { status: 404, headers: NO_STORE });
      case "already-resolved":
        return Response.json(
          { error: "This alert has already been resolved." },
          { status: 409, headers: NO_STORE },
        );
      case "booking-completed":
        return Response.json(
          { error: "The job has already been completed, so it can't be reassigned." },
          { status: 409, headers: NO_STORE },
        );
      case "invalid-cleaner":
        return Response.json(
          { error: "That cleaner isn't available on this day. Choose another one." },
          { status: 400, headers: NO_STORE },
        );
    }
  } catch {
    return Response.json(
      { error: "Could not resolve the alert. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
