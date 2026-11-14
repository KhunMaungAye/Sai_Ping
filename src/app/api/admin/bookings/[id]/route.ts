import { requireRole } from "../../../../../lib/auth.ts";
import {
  adminUpdateBooking,
  getAdminBooking,
  getAdminBookingChanges,
  type AdminBookingChanges,
} from "../../../../../lib/booking-store.ts";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };
const EDITABLE_FIELDS = ["address", "specialInstructions", "date", "time", "status"] as const;

/** US-08: GET /api/admin/bookings/[id] returns one booking and its recent admin changes. */
export async function GET(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  const { id } = await params;
  try {
    const booking = getAdminBooking(id);
    if (!booking) {
      return Response.json({ error: "Booking not found." }, { status: 404, headers: NO_STORE });
    }
    return Response.json(
      { booking, changes: getAdminBookingChanges(id) },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { error: "Could not load this booking. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}

/**
 * US-08: PATCH /api/admin/bookings/[id] updates a booking's details or service status.
 * Body (any of): { address, specialInstructions, date, time, status }.
 * Fields that are left out are not changed.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Send the fields to change." }, { status: 400, headers: NO_STORE });
  }

  const changes: AdminBookingChanges = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) changes[field] = (body as Record<string, unknown>)[field];
  }
  if (Object.keys(changes).length === 0) {
    return Response.json(
      { error: "Nothing to change. Send an address, special instructions, date, time or status." },
      { status: 400, headers: NO_STORE },
    );
  }

  const { id } = await params;
  try {
    const result = adminUpdateBooking(id, changes, { id: auth.user.id, name: auth.user.name });
    switch (result.status) {
      case "updated":
        return Response.json(
          {
            success: true,
            booking: result.booking,
            changes: getAdminBookingChanges(id),
            message: `Booking updated: ${result.changes.join("; ")}.`,
          },
          { headers: NO_STORE },
        );
      case "unchanged":
        return Response.json(
          {
            success: true,
            booking: result.booking,
            changes: getAdminBookingChanges(id),
            message: "Nothing changed.",
          },
          { headers: NO_STORE },
        );
      case "not-found":
        return Response.json({ error: "Booking not found." }, { status: 404, headers: NO_STORE });
      case "invalid":
        return Response.json({ error: result.error }, { status: 400, headers: NO_STORE });
      case "conflict":
        return Response.json({ error: result.error }, { status: 409, headers: NO_STORE });
    }
  } catch {
    return Response.json(
      { error: "The booking could not be updated. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
