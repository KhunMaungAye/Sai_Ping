import { requireRole } from "../../../../../../lib/auth.ts";
import { changeDraftCleaner } from "../../../../../../lib/shift-draft.ts";

type RouteContext = { params: Promise<{ bookingId: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * AI-02B: PATCH changes one job's cleaner in the unpublished draft.
 * Body: { "cleanerId": "cleaner-002" } or { "cleanerId": null } to leave it unassigned.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  let body: { cleanerId?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400, headers: NO_STORE });
  }
  const cleanerId = body?.cleanerId;
  if (!body || !("cleanerId" in body) || (cleanerId !== null && (typeof cleanerId !== "string" || !cleanerId))) {
    return Response.json(
      { error: "Choose a cleaner, or no cleaner, for this job." },
      { status: 400, headers: NO_STORE },
    );
  }

  const { bookingId } = await params;
  try {
    const result = changeDraftCleaner(bookingId, cleanerId as string | null);
    switch (result.status) {
      case "ok":
        return Response.json({ success: true, draft: result.draft }, { headers: NO_STORE });
      case "no-draft":
        return Response.json(
          { error: "There is no draft for next week. Generate one first." },
          { status: 404, headers: NO_STORE },
        );
      case "not-in-draft":
        return Response.json(
          { error: "That job isn't in this week's draft." },
          { status: 404, headers: NO_STORE },
        );
      case "unknown-cleaner":
        return Response.json(
          { error: "That cleaner doesn't exist or isn't active." },
          { status: 400, headers: NO_STORE },
        );
      case "published":
        return Response.json(
          { error: "This draft is already published. Generate a new draft to make changes." },
          { status: 409, headers: NO_STORE },
        );
      case "refused":
        return Response.json({ error: result.error }, { status: 409, headers: NO_STORE });
    }
  } catch {
    return Response.json(
      { error: "The change could not be saved. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
