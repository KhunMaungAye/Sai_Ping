import { requireRole } from "../../../../../lib/auth.ts";
import { cancelCustomerBooking } from "../../../../../lib/booking-store.ts";
import { CANCELLATION_NOTICE_HOURS } from "../../../../../lib/services.ts";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * US-05: a customer cancels one of their own one-time bookings, at least
 * 24 hours before the visit. The rule is checked here, not only in the page.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["customer"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const { id } = await params;

  try {
    const result = cancelCustomerBooking(id, auth.user.email);

    switch (result.status) {
      case "not-found":
        return Response.json(
          { error: "Booking not found." },
          { status: 404, headers: NO_STORE },
        );
      case "completed":
        return Response.json(
          { error: "This cleaning has already been completed, so it can't be cancelled." },
          { status: 409, headers: NO_STORE },
        );
      case "recurring":
        return Response.json(
          {
            error:
              "This visit is part of a recurring plan. Use Skip in My plans to cancel just this visit.",
          },
          { status: 409, headers: NO_STORE },
        );
      case "too-late":
        return Response.json(
          {
            error: `Bookings can only be cancelled at least ${CANCELLATION_NOTICE_HOURS} hours before the visit.`,
          },
          { status: 409, headers: NO_STORE },
        );
      default:
        return Response.json(
          { message: result.message, booking: result.booking },
          { status: 200, headers: NO_STORE },
        );
    }
  } catch {
    return Response.json(
      { error: "Your booking could not be cancelled. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
