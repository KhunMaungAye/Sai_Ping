import { requireRole } from "../../../../../../lib/auth.ts";
import { setCleanerApprovalStatus } from "../../../../../../lib/booking-store.ts";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/** US-19: admin approves or rejects a cleaner's application. */
export async function POST(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Choose approve or reject." }, { status: 400, headers: NO_STORE });
  }
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const action = record.action;
  if (action !== "approve" && action !== "reject") {
    return Response.json(
      { error: "Choose approve or reject." },
      { status: 400, headers: NO_STORE },
    );
  }
  const note = typeof record.note === "string" ? record.note.trim().slice(0, 500) : null;

  try {
    const result = setCleanerApprovalStatus(id, action, note);
    switch (result.status) {
      case "not-found":
        return Response.json(
          { error: "Cleaner application not found." },
          { status: 404, headers: NO_STORE },
        );
      case "invalid":
        return Response.json({ error: result.error }, { status: 400, headers: NO_STORE });
      default:
        return Response.json(
          {
            message:
              action === "approve"
                ? `${result.application.name}'s application has been approved.`
                : `${result.application.name}'s application has been rejected.`,
            application: result.application,
          },
          { status: 200, headers: NO_STORE },
        );
    }
  } catch (error) {
    console.error(`[US-19] updating approval for cleaner ${id} failed`, error);
    return Response.json(
      { error: "Could not update the application. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
