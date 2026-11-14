import { requireRole } from "../../../../../lib/auth.ts";
import { publishShiftDraft } from "../../../../../lib/shift-draft.ts";

const NO_STORE = { "Cache-Control": "no-store" };

/** AI-02B: POST publishes next week's draft, so its assignments become real jobs. */
export async function POST(request: Request) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  try {
    const result = publishShiftDraft();
    if (result.status === "no-draft") {
      return Response.json(
        { error: "There is no draft for next week. Generate one first." },
        { status: 404, headers: NO_STORE },
      );
    }
    if (result.status === "already-published") {
      return Response.json(
        { error: "This draft is already published." },
        { status: 409, headers: NO_STORE },
      );
    }
    const skippedNote =
      result.skipped.length > 0
        ? ` ${result.skipped.length} job${result.skipped.length === 1 ? " was" : "s were"} skipped because things changed since the draft was made.`
        : "";
    return Response.json(
      {
        success: true,
        draft: result.draft,
        assigned: result.assigned,
        skipped: result.skipped,
        message: `Published: ${result.assigned} job${result.assigned === 1 ? "" : "s"} assigned.${skippedNote}`,
      },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { error: "The draft could not be published. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
