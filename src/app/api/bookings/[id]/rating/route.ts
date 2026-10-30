import { getAuthenticatedUser } from "../../../../../lib/auth.ts";
import {
  getBookingRatingDetails,
  submitBookingRating,
} from "../../../../../lib/booking-store.ts";

type RouteContext = { params: Promise<{ id: string }> };

const REVIEW_LIMIT = 1000;

/** Only the customer who booked (or an admin) may see or rate a booking. */
function authorize(request: Request, customerEmail: string) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    return { error: "Please sign in to rate this cleaning.", status: 401 };
  }
  if (user.role === "admin") return { user };
  if (user.role !== "customer" || user.email.toLowerCase() !== customerEmail) {
    return { error: "You can only rate your own bookings.", status: 403 };
  }
  return { user };
}

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const booking = getBookingRatingDetails(id);

  if (!booking) {
    return Response.json({ error: "Booking not found." }, { status: 404 });
  }

  const auth = authorize(request, booking.customerEmail);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  return Response.json(
    { booking },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Choose a star rating from 1 to 5." },
      { status: 400 },
    );
  }

  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const stars = record.stars;
  if (
    typeof stars !== "number" ||
    !Number.isInteger(stars) ||
    stars < 1 ||
    stars > 5
  ) {
    return Response.json(
      { error: "Choose a star rating from 1 to 5." },
      { status: 400 },
    );
  }

  if (record.review !== undefined && record.review !== null && typeof record.review !== "string") {
    return Response.json({ error: "Your review must be text." }, { status: 400 });
  }
  const review = typeof record.review === "string" ? record.review.trim() : "";
  if (review.length > REVIEW_LIMIT) {
    return Response.json(
      { error: `Keep your review under ${REVIEW_LIMIT} characters.` },
      { status: 400 },
    );
  }

  const booking = getBookingRatingDetails(id);
  if (!booking) {
    return Response.json({ error: "Booking not found." }, { status: 404 });
  }

  const auth = authorize(request, booking.customerEmail);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.user.role !== "customer") {
    return Response.json(
      { error: "Only the customer who booked can leave a review." },
      { status: 403 },
    );
  }

  try {
    const result = submitBookingRating(id, stars, review || null);

    if (result.status === "not-found") {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }
    if (result.status === "not-completed") {
      return Response.json(
        { error: "You can rate this cleaner after the service is completed." },
        { status: 409 },
      );
    }
    if (result.status === "already-rated") {
      return Response.json(
        { error: "This booking has already been rated.", stars: result.stars },
        { status: 409 },
      );
    }

    return Response.json(
      { stars: result.stars, review: result.review },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { error: "Your rating could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
