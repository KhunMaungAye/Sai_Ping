import {
  createBooking,
  isBookableDate,
  isBookableTime,
  isServiceId,
  type BookingInput,
} from "@/lib/booking-store";

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Send booking details as JSON." },
      { status: 400 },
    );
  }

  if (!isRecord(body)) {
    return Response.json(
      { error: "Booking details are required." },
      { status: 400 },
    );
  }

  const name = text(body.name, 100);
  const email = text(body.email, 254).toLowerCase();
  const address = text(body.address, 300);
  const date = text(body.date, 10);
  const serviceId = body.serviceId;
  const time = body.time;

  if (
    name.length < 2 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    address.length < 5
  ) {
    return Response.json(
      { error: "Add your name, a valid email, and a full service address." },
      { status: 400 },
    );
  }

  if (
    !isServiceId(serviceId) ||
    !isBookableDate(date) ||
    !isBookableTime(date, time)
  ) {
    return Response.json(
      { error: "Choose a valid service, future date, and appointment time." },
      { status: 400 },
    );
  }

  const input: BookingInput = { name, email, address, date, serviceId, time };

  try {
    const result = createBooking(input);

    if (result.status === "unavailable") {
      return Response.json(
        {
          error:
            "That time was just booked. Please choose another appointment.",
          code: "SLOT_UNAVAILABLE",
        },
        { status: 409 },
      );
    }

    return Response.json({ booking: result.booking }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Your booking could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
