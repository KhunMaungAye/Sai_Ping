import { requireRole } from "../../../../../../lib/auth.ts";
import {
  DEFAULT_CLEANER,
  getBooking,
  getBookingAssignment,
  markBookingCompleted,
} from "../../../../../../lib/booking-store.ts";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["cleaner", "admin"]);
  if ("error" in auth) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { id } = await params;
  const booking = getBooking(id);

  if (!booking) {
    return Response.json(
      { error: "Booking not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { user } = auth;
  const assignment = getBookingAssignment(id);
  const cleanerId = user.cleanerId || user.id;

  if (user.role === "cleaner") {
    if (!assignment?.acceptedById) {
      return Response.json(
        { error: "Accept this booking before marking it completed." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (assignment.acceptedById !== cleanerId) {
      return Response.json(
        { error: "Forbidden. You can only complete your own assigned bookings." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (assignment?.status === "completed") {
    return Response.json(
      { success: true, status: "completed" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const assignedCleanerId = assignment?.acceptedById || DEFAULT_CLEANER.id;

  try {
    const result = markBookingCompleted(id, assignedCleanerId);
    if (result.status === "not-found") {
      return Response.json(
        { error: "Booking not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { success: true, status: "completed" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not mark booking complete." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
