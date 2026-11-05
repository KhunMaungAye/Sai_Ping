import { requireRole } from "../../../lib/auth.ts";
import {
  getRecommendedCleaner,
  isBookableDate,
  listAvailableSlots,
  TIME_SLOTS,
  type BookingTime,
} from "../../../lib/booking-store.ts";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * AI-01A: GET /api/recommendation?date=YYYY-MM-DD&time=09:00
 * Returns the recommended cleaner for an open arrival window, or
 * `recommendation: null` when no cleaner is eligible.
 */
export async function GET(request: Request) {
  const auth = requireRole(request, ["customer"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const params = new URL(request.url).searchParams;
  const date = params.get("date") ?? "";
  const time = params.get("time") ?? "";

  if (!isBookableDate(date)) {
    return Response.json(
      { error: "Choose a valid date from today onward." },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!TIME_SLOTS.some((slot) => slot === time)) {
    return Response.json(
      { error: `Choose an arrival window: ${TIME_SLOTS.join(" or ")}.` },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    if (!listAvailableSlots(date).includes(time as BookingTime)) {
      return Response.json(
        { error: "That arrival window is no longer open. Please choose another." },
        { status: 409, headers: NO_STORE },
      );
    }

    return Response.json(
      { date, time, recommendation: getRecommendedCleaner(date, time as BookingTime) },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { error: "The recommendation could not be loaded. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
