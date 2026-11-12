import type { VisitUpdateResult } from "./booking-store.ts";

const NO_STORE = { "Cache-Control": "no-store" };

/** US-09: maps a cleaner visit update to an HTTP response (shared with running-late). */
export function visitResponse(result: VisitUpdateResult, okMessage: string) {
  switch (result.status) {
    case "ok":
      return Response.json({ success: true, message: okMessage, ...result }, { headers: NO_STORE });
    case "not-found":
      return Response.json({ error: "Job not found." }, { status: 404, headers: NO_STORE });
    case "forbidden":
      return Response.json(
        { error: "You can only update your own assigned jobs." },
        { status: 403, headers: NO_STORE },
      );
    case "completed":
      return Response.json(
        { error: "This job is already completed." },
        { status: 409, headers: NO_STORE },
      );
    case "already-arrived":
      return Response.json(
        { error: "You have already checked in for this job.", arrivedAt: result.arrivedAt },
        { status: 409, headers: NO_STORE },
      );
    case "too-early":
      return Response.json(
        { error: "Check-in opens one hour before the arrival time.", opensAt: result.opensAt },
        { status: 409, headers: NO_STORE },
      );
    case "too-late":
      return Response.json(
        {
          error:
            "It's too late to report a delay: the admin has been alerted. Check in as soon as you arrive.",
        },
        { status: 409, headers: NO_STORE },
      );
    case "past-day":
      return Response.json(
        { error: "Check-in is only open on the day of the job." },
        { status: 409, headers: NO_STORE },
      );
    case "already-reported":
      return Response.json(
        {
          error: `You already said you'd be ${result.lateMinutes} minutes late. Check in as soon as you arrive.`,
        },
        { status: 409, headers: NO_STORE },
      );
    case "invalid":
      return Response.json(
        { error: "Choose 15, 30 or 45 minutes." },
        { status: 400, headers: NO_STORE },
      );
  }
}
