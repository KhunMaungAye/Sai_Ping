import { requireRole } from "../../../../lib/auth.ts";
import {
  getCleanerBookings,
  getAvailableBookingRequests,
  getCleanerAvailableDays,
  DEFAULT_CLEANER,
} from "../../../../lib/booking-store.ts";

export async function GET(request: Request) {
  const auth = requireRole(request, ["cleaner", "admin"]);
  if ("error" in auth) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { user } = auth;
  // If user is a cleaner, strictly use their assigned cleanerId
  const cleanerId =
    user.role === "cleaner"
      ? (user.cleanerId || user.id)
      : (new URL(request.url).searchParams.get("cleanerId") || user.cleanerId || DEFAULT_CLEANER.id);

  try {
    const bookings = getCleanerBookings(cleanerId);
    const availableRequests = getAvailableBookingRequests();
    const availableDays = getCleanerAvailableDays(cleanerId);
    return Response.json(
      {
        cleanerId,
        cleanerName: user.name,
        bookings,
        availableRequests,
        availableDays,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { error: "Could not load cleaner assignments." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
