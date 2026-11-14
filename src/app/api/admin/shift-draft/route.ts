import { requireRole } from "../../../../lib/auth.ts";
import { generateShiftDraft, getShiftDraft, nextWeek } from "../../../../lib/shift-draft.ts";

const NO_STORE = { "Cache-Control": "no-store" };

/** AI-02B: GET the latest weekly shift draft for next week (or `draft: null`). */
export async function GET(request: Request) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  try {
    return Response.json({ week: nextWeek(), draft: getShiftDraft() }, { headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "The shift draft could not be loaded. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}

/** AI-02B: POST generates a new draft for next week (replacing an unpublished one). */
export async function POST(request: Request) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  try {
    const result = generateShiftDraft(auth.user.name);
    if (result.status === "empty") {
      return Response.json(
        { success: true, week: nextWeek(), draft: getShiftDraft(), message: result.message },
        { headers: NO_STORE },
      );
    }
    const flaggedNote =
      result.flagged > 0
        ? ` ${result.flagged} job${result.flagged === 1 ? "" : "s"} flagged "No cleaner available".`
        : "";
    return Response.json(
      {
        success: true,
        week: nextWeek(),
        draft: result.draft,
        message: `Draft ready: ${result.assigned} job${result.assigned === 1 ? "" : "s"} assigned.${flaggedNote} Nothing is final until you publish.`,
      },
      { status: 201, headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { error: "The shift draft could not be generated. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
