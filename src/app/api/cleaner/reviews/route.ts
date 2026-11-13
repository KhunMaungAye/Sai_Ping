import { requireRole } from "../../../../lib/auth.ts";
import { listReviews } from "../../../../lib/booking-store.ts";
import { summarizeReviews } from "../../../../lib/review-tags.ts";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * US-16: the signed-in cleaner's own ratings, written reviews and tags, plus
 * their average. The cleaner id comes from the session, never the request, so
 * a cleaner can only ever see their own feedback. Admins see everyone's through
 * /api/admin/overview.
 */
export async function GET(request: Request) {
  const auth = requireRole(request, ["cleaner"]);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  const cleanerId = auth.user.cleanerId || auth.user.id;
  const reviews = listReviews(cleanerId).map((review) => ({
    bookingId: review.bookingId,
    serviceName: review.serviceName,
    serviceDate: review.serviceDate,
    // Cleaners see the customer's name, not their email.
    customerName: review.customerName,
    stars: review.stars,
    review: review.review,
    tags: review.tags,
    createdAt: review.createdAt,
  }));
  return Response.json({ summary: summarizeReviews(reviews), reviews }, { headers: NO_STORE });
}
