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
