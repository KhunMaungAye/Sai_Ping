import { requireRole } from "../../../../../../lib/auth.ts";
import {
  DEFAULT_CLEANER,
  getBooking,
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
  const assignedCleanerId = user.cleanerId || DEFAULT_CLEANER.id;

  // Cleaners can only complete bookings assigned to them
  if (user.role === "cleaner") {
    // If booking already has a cleaner assigned and it's not this cleaner
    const dbBooking = getBooking(id);
    if (dbBooking && dbBooking.cleanerName !== user.name && dbBooking.cleanerName !== "Sai Ping Cleaning Team") {
      return Response.json(
        { error: "Forbidden. You can only complete your own assigned bookings." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

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
