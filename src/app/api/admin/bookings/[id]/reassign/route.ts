import { requireRole } from "../../../../../../lib/auth.ts";
import { getReassignOptions, reassignBooking } from "../../../../../../lib/booking-store.ts";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

const ERRORS = {
  "not-found": { status: 404, error: "Booking not found." },
  "booking-completed": { status: 409, error: "This cleaning is already completed, so it can't be reassigned." },
  "booking-past": { status: 409, error: "This cleaning date has passed, so it can't be reassigned." },
  // AI-02A: the chosen cleaner has another job too close to this one that day.
  "travel-time": { status: 409, error: "Slot unavailable: travel time needed" },
  "invalid-cleaner": {
    status: 400,
    error: "Choose an active cleaner who works on that day (not the one already assigned).",
  },
} as const;

/** US-10: the cleaners an admin can move this booking to. */
export async function GET(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  const { id } = await params;
  const result = getReassignOptions(id);
  if (result.status !== "ok") {
    const { status, error } = ERRORS[result.status];
    return Response.json({ error }, { status, headers: NO_STORE });
  }
  return Response.json({ booking: result.booking, cleaners: result.cleaners }, { headers: NO_STORE });
}

/** US-10: reassign the booking. Body: { cleanerId: "..." } */
export async function POST(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  const body = (await request.json().catch(() => null)) as { cleanerId?: unknown } | null;
  const cleanerId = typeof body?.cleanerId === "string" ? body.cleanerId.trim() : "";
  if (!cleanerId) {
    return Response.json({ error: "Choose a cleaner to assign this booking to." }, { status: 400, headers: NO_STORE });
  }

  const { id } = await params;
  const result = reassignBooking(id, cleanerId, auth.user.name);
  if (result.status !== "ok") {
    const { status, error } = ERRORS[result.status];
    return Response.json({ error }, { status, headers: NO_STORE });
  }
  const message = result.previousCleanerName
    ? `Booking reassigned from ${result.previousCleanerName} to ${result.cleanerName}. It's now on ${result.cleanerName}'s schedule.`
    : `Booking assigned to ${result.cleanerName}. It's now on their schedule.`;
  return Response.json(
    { message, cleanerName: result.cleanerName, previousCleanerName: result.previousCleanerName },
    { headers: NO_STORE },
  );
}
