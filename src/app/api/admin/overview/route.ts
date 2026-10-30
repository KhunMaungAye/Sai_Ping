import { requireRole } from "../../../../lib/auth.ts";
import {
  getAdminCleanerSummaries,
  getAdminCustomerSummaries,
  listReviews,
} from "../../../../lib/booking-store.ts";

export async function GET(request: Request) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return Response.json(
      {
        cleaners: getAdminCleanerSummaries(),
        customers: getAdminCustomerSummaries(),
        reviews: listReviews(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not retrieve cleaner and customer records." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
