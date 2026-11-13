import { requireRole } from "../../../../../lib/auth.ts";
import { getCleanerBookings } from "../../../../../lib/booking-store.ts";
import { jobPreparation } from "../../../../../lib/service-specs.ts";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * US-07: preparation details for one job — the booking itself, its schedule and
 * the service specs. Only the cleaner who accepted the job gets it; any other
 * booking is "not found" so ids can't be probed.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["cleaner"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  const { id } = await params;
  const cleanerId = auth.user.cleanerId || auth.user.id;

  const job = getCleanerBookings(cleanerId).find((booking) => booking.id === id);
  if (!job) {
    return Response.json(
      { error: "Job not found. It may not be assigned to you." },
      { status: 404, headers: NO_STORE },
    );
  }

  return Response.json(
    {
      job: {
        id: job.id,
        customerName: job.name,
        customerEmail: job.email,
        serviceId: job.serviceId,
        serviceName: job.serviceName,
        date: job.date,
        time: job.time,
        address: job.address,
        // Older bookings may hold an empty note; treat it as "no instructions".
        specialInstructions: job.specialInstructions?.trim() || null,
        status: job.status,
        isRecurring: Boolean(job.subscriptionId),
      },
      preparation: jobPreparation(job.serviceId, job.time),
    },
    { headers: NO_STORE },
  );
}
