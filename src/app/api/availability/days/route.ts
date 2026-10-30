import { listAvailableDays } from "../../../../lib/booking-store.ts";

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("count"));
  const count = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 60) : 21;

  try {
    return Response.json(
      { days: listAvailableDays(undefined, count) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Availability could not be checked. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
