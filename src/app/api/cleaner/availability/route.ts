import { requireRole } from "../../../../lib/auth.ts";
import {
  getCleanerAvailableDays,
  setCleanerAvailableDays,
} from "../../../../lib/booking-store.ts";

function cleanerIdOf(user: { cleanerId: string | null; id: string }) {
  return user.cleanerId || user.id;
}

export async function GET(request: Request) {
  const auth = requireRole(request, ["cleaner"]);
  if ("error" in auth) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { availableDays: getCleanerAvailableDays(cleanerIdOf(auth.user)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const auth = requireRole(request, ["cleaner"]);
  if ("error" in auth) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Send availableDays as a JSON array of weekday numbers (0-6)." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const days =
    typeof body === "object" && body !== null && "availableDays" in body
      ? (body as { availableDays: unknown }).availableDays
      : undefined;

  if (
    !Array.isArray(days) ||
    !days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  ) {
    return Response.json(
      { error: "Send availableDays as a JSON array of weekday numbers (0-6)." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const saved = setCleanerAvailableDays(cleanerIdOf(auth.user), days as number[]);
  return Response.json(
    { success: true, availableDays: saved },
    { headers: { "Cache-Control": "no-store" } },
  );
}
