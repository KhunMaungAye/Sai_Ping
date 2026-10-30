import { requireRole } from "../../../../../../lib/auth.ts";
import { acceptBookingRequest } from "../../../../../../lib/booking-store.ts";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, ["cleaner"]);
  if ("error" in auth) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { user } = auth;
  const { id } = await context.params;

  if (!id) {
    return Response.json(
      { error: "Booking ID is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cleanerId = user.cleanerId || user.id;
  const cleanerName = user.name || "Assigned Cleaner";

  const result = acceptBookingRequest(id, cleanerId, cleanerName);
  if (!result.success) {
    return Response.json(
      { error: result.error || "Could not accept booking." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      success: true,
      message: `Booking request accepted by ${cleanerName}.`,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
