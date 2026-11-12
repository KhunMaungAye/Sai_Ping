// US-14: customer booking status badges. No server imports, so pages can use it.

/**
 * US-14: the status badge a customer sees on a booking.
 * Upcoming: "confirmed" (a cleaner accepted) or "awaiting-cleaner".
 * Past: "completed", "not-completed" (accepted but never marked done) or
 * "no-cleaner" (the date passed without any cleaner accepting it).
 */
export type BookingBadge =
  | "confirmed"
  | "awaiting-cleaner"
  | "completed"
  | "not-completed"
  | "no-cleaner";

export function bookingBadge(
  status: "scheduled" | "completed",
  isAccepted: boolean,
  isUpcoming: boolean,
): BookingBadge {
  if (status === "completed") return "completed";
  if (isUpcoming) return isAccepted ? "confirmed" : "awaiting-cleaner";
  return isAccepted ? "not-completed" : "no-cleaner";
}

export const BOOKING_BADGE_LABELS: Record<BookingBadge, string> = {
  confirmed: "Confirmed & Accepted",
  "awaiting-cleaner": "Requested (Awaiting Cleaner)",
  completed: "Completed",
  "not-completed": "Not completed",
  "no-cleaner": "No cleaner assigned",
};

/** CSS modifier for each badge (classes in globals.css). */
export const BOOKING_BADGE_CLASSES: Record<BookingBadge, string> = {
  confirmed: "status-badge-scheduled",
  "awaiting-cleaner": "status-badge-pending",
  completed: "status-badge-completed",
  "not-completed": "status-badge-missed",
  "no-cleaner": "status-badge-missed",
};
