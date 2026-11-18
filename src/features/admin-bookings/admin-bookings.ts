// US-17A: helpers for the admin Bookings tab (status filter, sort order, cleaner label).
// Kept free of database code so the client page and node tests can both use them.

export type BookingStatusFilter = "all" | "scheduled" | "completed";

export const BOOKING_STATUS_FILTERS: ReadonlyArray<{
  value: BookingStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
];

export const NOT_ACCEPTED_LABEL = "Not accepted yet";
export const NO_MATCHING_BOOKINGS_MESSAGE = "No bookings match this filter";

type FilterableBooking = {
  date: string;
  time: string;
  status: "scheduled" | "completed";
};

/** Earliest date first, then the 09:00 slot before the 14:00 slot. */
export function compareBookingsByDateThenSlot(a: FilterableBooking, b: FilterableBooking): number {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
}

/**
 * Returns the bookings that match the filter, sorted by date and then time slot.
 * The input array is not changed.
 */
export function filterAdminBookings<T extends FilterableBooking>(
  bookings: readonly T[],
  filter: BookingStatusFilter,
): T[] {
  const matching =
    filter === "all" ? [...bookings] : bookings.filter((booking) => booking.status === filter);
  return matching.sort(compareBookingsByDateThenSlot);
}

/** How many bookings each filter would show, for the filter button counts. */
export function countBookingsByStatus(
  bookings: readonly FilterableBooking[],
): Record<BookingStatusFilter, number> {
  let scheduled = 0;
  let completed = 0;
  for (const booking of bookings) {
    if (booking.status === "completed") completed += 1;
    else scheduled += 1;
  }
  return { all: bookings.length, scheduled, completed };
}

/** The accepting cleaner's name, or "Not accepted yet" while no cleaner has accepted. */
export function adminCleanerLabel(booking: { acceptedByName?: string | null }): string {
  const name = booking.acceptedByName?.trim();
  return name ? name : NOT_ACCEPTED_LABEL;
}

/**
 * US-08: bookings whose reference, customer, email, address, service or
 * cleaner contains the search text (case-insensitive). Empty text matches all.
 * A reference can be typed with or without a leading "#".
 */
export function searchAdminBookings<
  T extends {
    id: string;
    name: string;
    email: string;
    address: string;
    serviceName: string;
    acceptedByName?: string | null;
  },
>(bookings: readonly T[], query: string): T[] {
  const needle = query.trim().replace(/^#/, "").toLowerCase();
  if (!needle) return [...bookings];
  return bookings.filter((booking) =>
    [
      booking.id,
      booking.name,
      booking.email,
      booking.address,
      booking.serviceName,
      booking.acceptedByName ?? "",
    ].some((value) => value.toLowerCase().includes(needle)),
  );
}

export const NO_SEARCH_RESULTS_MESSAGE = "No bookings match your search";
