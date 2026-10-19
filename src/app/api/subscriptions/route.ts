import {
  checkRecurringAvailability,
  createRecurringSubscription,
  getNextServiceDate,
  getSubscription,
  isBookableDate,
  isBookableTime,
  isServiceId,
  localDateString,
  normalizeDayName,
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const details = getSubscription(id);
    if (!details) {
      return Response.json(
        { error: "Subscription not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(details, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const startDate = url.searchParams.get("startDate");
  const frequency = url.searchParams.get("frequency") as Frequency | null;
  const time = url.searchParams.get("time") as BookingTime | null;
  const preferredDay = url.searchParams.get("preferredDay") || undefined;
  const endDate = url.searchParams.get("endDate") || undefined;

  if (!startDate || !frequency || !time) {
    return Response.json(
      { error: "Provide startDate, frequency, and time to check recurring availability." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (frequency !== "weekly" && frequency !== "biweekly") {
    return Response.json(
      { error: "Choose a subscription frequency: weekly or biweekly." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (startDate < localDateString() || !isBookableDate(startDate)) {
    return Response.json(
      { error: "Choose a valid start date from today onward." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (endDate && endDate < startDate) {
    return Response.json(
      { error: "End date cannot be earlier than start date." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const availability = checkRecurringAvailability({
      startDate,
      frequency,
      time,
      endDate: endDate || null,
      preferredDay,
    });

    return Response.json(availability, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Recurring availability could not be checked." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Send subscription details as JSON." },
      { status: 400 },
    );
  }

  if (!isRecord(body)) {
    return Response.json(
      { error: "Subscription details are required." },
      { status: 400 },
    );
  }

  const name = text(body.name, 100);
  const email = text(body.email, 254).toLowerCase();
  const address = text(body.address, 300);
  const startDate = text(body.startDate ?? body.date, 10);
  const endDateRaw = body.endDate ? text(body.endDate, 10) : "";
  const endDate = endDateRaw || null;
  const serviceId = body.serviceId;
  const frequency = body.frequency as Frequency;
  const preferredDay = body.preferredDay ? text(body.preferredDay, 20) : undefined;
  const time = body.time as BookingTime;
  const occurrences =
    typeof body.occurrences === "number" && body.occurrences > 0
      ? body.occurrences
      : undefined;

  const headerIdempotency = request.headers.get("idempotency-key") || undefined;
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 100)
      : headerIdempotency;

  // Basic contact validations
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

  // Service validation
  if (!isServiceId(serviceId)) {
    return Response.json(
      { error: "Choose a valid cleaning service." },
      { status: 400 },
    );
  }

  // Frequency validation (weekly or biweekly)
  if (frequency !== "weekly" && frequency !== "biweekly") {
    return Response.json(
      { error: "Choose a subscription frequency: weekly or biweekly." },
      { status: 400 },
    );
  }

  // Preferred day validation
  if (preferredDay && !normalizeDayName(preferredDay)) {
    return Response.json(
      { error: "Choose a valid preferred day of the week." },
      { status: 400 },
    );
  }

  // Edge Case 2: Past or invalid start date rejection
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return Response.json(
      { error: "Start date must be a valid date in YYYY-MM-DD format." },
      { status: 400 },
    );
  }

  if (startDate < localDateString()) {
    return Response.json(
      { error: "Start date cannot be in the past." },
      { status: 400 },
    );
  }

  if (!isBookableDate(startDate)) {
    return Response.json(
      { error: "Choose a valid future start date." },
      { status: 400 },
    );
  }

  // Calculate next scheduled service date
  const nextServiceDate = getNextServiceDate(startDate, preferredDay);

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

  // Edge Case 3: End date cannot be earlier than start date
  if (endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return Response.json(
        { error: "End date must be a valid date in YYYY-MM-DD format." },
        { status: 400 },
      );
    }

    const endCheck = new Date(`${endDate}T00:00:00.000Z`);
    if (
      Number.isNaN(endCheck.getTime()) ||
      endCheck.toISOString().slice(0, 10) !== endDate
    ) {
      return Response.json(
        { error: "End date is not a valid calendar date." },
        { status: 400 },
      );
    }

    if (endDate < startDate) {
      return Response.json(
        {
          error: "End date cannot be earlier than start date.",
          code: "INVALID_END_DATE",
        },
        { status: 400 },
      );
    }
  }

  const input: SubscriptionInput = {
    name,
    email,
    address,
    serviceId,
    frequency,
    preferredDay,
    startDate,
    endDate,
    occurrences,
    time,
    idempotencyKey,
  };

  try {
    const result = createRecurringSubscription(input);

    // Edge Case 1: Cleaner unavailable on any recurring date
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
