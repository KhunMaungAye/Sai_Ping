import { isBookableDate, listAvailableSlots } from "@/lib/booking-store";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");

  if (!date || !isBookableDate(date)) {
    return Response.json(
      { error: "Choose a valid date from today onward." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return Response.json(
      { date, availableSlots: listAvailableSlots(date) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Availability could not be checked. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
