import {
  getBookingRatingDetails,
  submitBookingRating,
} from "@/lib/booking-store";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const booking = getBookingRatingDetails(id);

  if (!booking) {
    return Response.json({ error: "Booking not found." }, { status: 404 });
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

  const stars =
    typeof body === "object" && body !== null && "stars" in body
      ? body.stars
      : undefined;
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

  try {
    const result = submitBookingRating(id, stars);

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

    return Response.json({ stars: result.stars }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Your rating could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
