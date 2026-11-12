export const SERVICES = [
  {
    id: "essential",
    name: "Essential clean",
    description: "A thoughtful reset for the rooms you use every day.",
    duration: "2 hours",
    priceCents: 8900,
  },
  {
    id: "deep",
    name: "Deep clean",
    description:
      "Extra detail for kitchens, bathrooms, and everything between.",
    duration: "3 hours",
    priceCents: 14900,
  },
  {
    id: "move-out",
    name: "Move-in / move-out",
    description: "A complete clean to make a fresh start feel easy.",
    duration: "4 hours",
    priceCents: 18900,
  },
] as const;

export type ServiceId = (typeof SERVICES)[number]["id"];

export const TIME_SLOTS = ["09:00", "14:00"] as const;
export type BookingTime = (typeof TIME_SLOTS)[number];

/** US-13: longest special-instructions note a customer can add to a booking. */
export const SPECIAL_INSTRUCTIONS_MAX_LENGTH = 250;

export type SpecialInstructionsResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Validates optional special instructions from a booking request: trims the
 * text, turns an empty note into null and rejects notes over the limit.
 * Shared by the booking form and the booking API so both apply the same rule.
 */
export function parseSpecialInstructions(raw: unknown): SpecialInstructionsResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, error: "Special instructions must be text." };
  }
  const value = raw.trim();
  if (value.length > SPECIAL_INSTRUCTIONS_MAX_LENGTH) {
    return {
      ok: false,
      error: `Special instructions must be ${SPECIAL_INSTRUCTIONS_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, value: value || null };
}

/** US-05: a booking can be cancelled up to this many hours before it starts. */
export const CANCELLATION_NOTICE_HOURS = 24;

/** Sai Ping works in Bangkok (UTC+7, no daylight saving), so visit times are Bangkok times. */
const SERVICE_UTC_OFFSET = "+07:00";

/** The moment a visit starts, e.g. ("2026-11-20", "09:00") -> 09:00 Bangkok time. */
export function getServiceStartTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${SERVICE_UTC_OFFSET}`);
}

/**
 * US-05 rule, shared by the customer page (to show the button) and the API
 * (which enforces it): cancelling is allowed when the visit starts at least
 * 24 hours from `now`. Exactly 24 hours is allowed.
 */
export function isWithinCancellationWindow(
  date: string,
  time: string,
  now: Date = new Date(),
): boolean {
  const start = getServiceStartTime(date, time).getTime();
  if (Number.isNaN(start)) return false;
  return start - now.getTime() >= CANCELLATION_NOTICE_HOURS * 60 * 60 * 1000;
}
