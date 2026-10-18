import { timingSafeEqual } from "node:crypto";
import { DEFAULT_CLEANER, markBookingCompleted } from "@/lib/booking-store";

type RouteContext = { params: Promise<{ id: string }> };

function matchesSecret(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export async function POST(request: Request, { params }: RouteContext) {
  const expectedKey = process.env.BOOKING_ADMIN_KEY;
  if (!expectedKey) {
    return Response.json(
      { error: "Booking completion is not configured." },
      { status: 503 },
    );
  }

  const providedKey = request.headers.get("x-admin-key") ?? "";
  if (!matchesSecret(providedKey, expectedKey)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let cleanerId: string = DEFAULT_CLEANER.id;
  try {
    const body: unknown = await request.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "cleanerId" in body &&
      typeof body.cleanerId === "string"
    ) {
      cleanerId = body.cleanerId.trim().slice(0, 100);
    }
  } catch {
    // An empty body uses the booking's default cleaner.
  }

  const { id } = await params;
  try {
    const result = markBookingCompleted(id, cleanerId);
    if (result.status === "not-found") {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }
    if (result.status === "unknown-cleaner") {
      return Response.json({ error: "Cleaner not found." }, { status: 400 });
    }

    return Response.json({ status: "completed" });
  } catch {
    return Response.json(
      { error: "The booking could not be marked complete." },
      { status: 500 },
    );
  }
}
