import { requireSessionRole } from "../../../../../lib/auth.ts";
import { editCustomerBooking } from "../../../../../lib/booking-store.ts";
import {
  CANCELLATION_NOTICE_HOURS,
  TIME_SLOTS,
  parseSpecialInstructions,
  type BookingTime,
} from "../../../../../lib/services.ts";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

function isTimeSlot(value: unknown): value is BookingTime {
  return typeof value === "string" && (TIME_SLOTS as readonly string[]).includes(value);
}

/**
 * Bug Card 2: a customer edits the date, arrival window and/or special
 * instructions of one of their own one-time bookings, at least 24 hours
 * before the visit (same notice as US-05 cancelling).
 */
export async function POST(request: Request, { params }: RouteContext) {
  // Only a real signed-in session counts here, same as the US-05 cancel route.
  const auth = requireSessionRole(request, ["customer"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Choose a date, arrival window and/or special instructions to update." },
      { status: 400, headers: NO_STORE },
    );
  }
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  if (typeof record.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    return Response.json({ error: "Choose a valid date." }, { status: 400, headers: NO_STORE });
  }
  if (!isTimeSlot(record.time)) {
    return Response.json({ error: "Choose a valid arrival window." }, { status: 400, headers: NO_STORE });
  }
  const instructions = parseSpecialInstructions(record.specialInstructions);
  if (!instructions.ok) {
    return Response.json({ error: instructions.error }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = editCustomerBooking(id, auth.user.email, {
      date: record.date,
      time: record.time,
      specialInstructions: instructions.value,
    });

    switch (result.status) {
      case "not-found":
        return Response.json({ error: "Booking not found." }, { status: 404, headers: NO_STORE });
      case "completed":
        return Response.json(
          { error: "This cleaning has already been completed, so it can't be edited." },
          { status: 409, headers: NO_STORE },
        );
      case "recurring":
        return Response.json(
          {
            error:
              "This visit is part of a recurring plan. Use Manage Plan in Recurring Plans to change it.",
          },
          { status: 409, headers: NO_STORE },
        );
      case "too-late":
        return Response.json(
          {
            error: `Bookings can only be edited at least ${CANCELLATION_NOTICE_HOURS} hours before the visit.`,
          },
          { status: 409, headers: NO_STORE },
        );
      case "invalid":
        return Response.json({ error: result.error }, { status: 400, headers: NO_STORE });
      case "unavailable":
        return Response.json(
          { error: "That arrival window is already booked. Choose another date or time." },
          { status: 409, headers: NO_STORE },
        );
      default:
        return Response.json(
          { message: result.message, booking: result.booking },
          { status: 200, headers: NO_STORE },
        );
    }
  } catch (error) {
    console.error(`[Bug Card 2] editing booking ${id} failed`, error);
    return Response.json(
      { error: "Your booking could not be updated. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
