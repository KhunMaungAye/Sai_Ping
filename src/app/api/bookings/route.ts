import {
  createBooking,
  createRecurringSubscription,
  getNextServiceDate,
  isBookableDate,
  isBookableTime,
  isServiceId,
  localDateString,
  normalizeDayName,
  type BookingInput,
  type BookingTime,
  type Frequency,
  type SubscriptionInput,
} from "../../../lib/booking-store.ts";

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
  const date = text(body.date ?? body.startDate, 10);
  const serviceId = body.serviceId;
  const time = body.time as BookingTime;
  const frequency = body.frequency as Frequency | undefined;

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

  // Handle recurring subscription when frequency is specified
  if (frequency) {
    if (frequency !== "weekly" && frequency !== "biweekly") {
      return Response.json(
        { error: "Choose a subscription frequency: weekly or biweekly." },
        { status: 400 },
      );
    }

    const preferredDay = body.preferredDay
      ? text(body.preferredDay, 20)
      : undefined;
    const endDateRaw = body.endDate ? text(body.endDate, 10) : "";
    const endDate = endDateRaw || null;
    const occurrences =
      typeof body.occurrences === "number" && body.occurrences > 0
        ? body.occurrences
        : undefined;

    const headerIdempotency =
      request.headers.get("idempotency-key") || undefined;
    const idempotencyKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim().slice(0, 100)
        : headerIdempotency;

    if (!isServiceId(serviceId)) {
      return Response.json(
        { error: "Choose a valid cleaning service." },
        { status: 400 },
      );
    }

    if (preferredDay && !normalizeDayName(preferredDay)) {
      return Response.json(
        { error: "Choose a valid preferred day of the week." },
        { status: 400 },
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json(
        { error: "Start date must be a valid date in YYYY-MM-DD format." },
        { status: 400 },
      );
    }

    if (date < localDateString()) {
      return Response.json(
        { error: "Start date cannot be in the past." },
        { status: 400 },
      );
    }

    if (!isBookableDate(date)) {
      return Response.json(
        { error: "Choose a valid future start date." },
        { status: 400 },
      );
    }

    const nextServiceDate = getNextServiceDate(date, preferredDay);
    if (!isBookableDate(nextServiceDate)) {
      return Response.json(
        { error: "Next scheduled service date is invalid or in the past." },
        { status: 400 },
      );
    }

    if (!isBookableTime(nextServiceDate, time)) {
      return Response.json(
        { error: "Choose a future appointment arrival time." },
        { status: 400 },
      );
    }

    if (endDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return Response.json(
          { error: "End date must be a valid date in YYYY-MM-DD format." },
          { status: 400 },
        );
      }
      if (endDate < date) {
        return Response.json(
          {
            error: "End date cannot be earlier than start date.",
            code: "INVALID_END_DATE",
          },
          { status: 400 },
        );
      }
    }

    const subscriptionInput: SubscriptionInput = {
      name,
      email,
      address,
      serviceId,
      frequency,
      preferredDay,
      startDate: date,
      endDate,
      occurrences,
      time,
      idempotencyKey,
    };

    try {
      const result = createRecurringSubscription(subscriptionInput);
      if (result.status === "conflict") {
        return Response.json(
          {
            error: result.error,
            code: "RECURRING_SLOT_UNAVAILABLE",
            conflictDate: result.conflictDate,
            time: result.time,
          },
          { status: 409 },
        );
      }

      const statusCode = result.isDuplicate ? 200 : 201;
      return Response.json(
        {
          subscription: result.subscription,
          booking: result.bookings[0],
          bookings: result.bookings,
          isDuplicate: result.isDuplicate ?? false,
        },
        { status: statusCode },
      );
    } catch {
      return Response.json(
        { error: "Your subscription could not be saved. Please try again." },
        { status: 500 },
      );
    }
  }

  // Single one-time booking
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
