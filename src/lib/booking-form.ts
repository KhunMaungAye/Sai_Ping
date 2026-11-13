// Bug Card 1 (found by the Fleet Delivery team in BH-04): the booking
// form used to disable "Confirm Booking Request" while a required field was
// empty, so customers never saw which field was missing. The form now checks
// the fields when Confirm is clicked and names the missing one.
// No React or database code, so node tests can check the rules directly.

export const DATE_REQUIRED_MESSAGE = "Start date cannot be in the past.";
export const TIME_REQUIRED_MESSAGE = "Please choose an arrival time slot.";
export const ADDRESS_REQUIRED_MESSAGE = "Please enter your cleaning address.";

export type BookingFormField = "date" | "time" | "address";

export type BookingFormProblem = { field: BookingFormField; message: string };

/**
 * The first required field that is missing, in the order the form shows them,
 * or null when the date, time and address are all filled in.
 */
export function findBookingFormProblem(input: {
  date: string;
  time: string;
  address: string;
  /** Earliest date a booking can start (YYYY-MM-DD); empty while it's loading. */
  minimumDate: string;
}): BookingFormProblem | null {
  if (!input.date || (input.minimumDate && input.date < input.minimumDate)) {
    return { field: "date", message: DATE_REQUIRED_MESSAGE };
  }
  if (!input.time) return { field: "time", message: TIME_REQUIRED_MESSAGE };
  if (!input.address.trim()) return { field: "address", message: ADDRESS_REQUIRED_MESSAGE };
  return null;
}
