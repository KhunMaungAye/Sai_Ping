import { requireRole } from "../../../../lib/auth.ts";
import { getAllBookingsAdmin, getPlatformStats } from "../../../../lib/booking-store.ts";

export async function GET(request: Request) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const bookings = getAllBookingsAdmin();
    const stats = getPlatformStats();

    return Response.json(
      {
        stats,
        bookings,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { error: "Could not retrieve admin booking data." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
