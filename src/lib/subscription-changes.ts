// US-04: validate a customer's changes to a recurring plan (frequency, day,
// arrival time, service, address, special instructions).
// No database code here, so the plan form, the API route and node tests share it.

import { normalizeDayName, type DayOfWeekName, type Frequency } from "./date-utils.ts";
import {
  SERVICES,
  TIME_SLOTS,
  parseSpecialInstructions,
  type BookingTime,
  type ServiceId,
} from "./services.ts";

export const ADDRESS_MIN_LENGTH = 5;
export const ADDRESS_MAX_LENGTH = 300;

/** Fields a customer may change. Each one is optional; only the ones sent are changed. */
export type SubscriptionChanges = {
  frequency?: Frequency;
  preferredDay?: DayOfWeekName;
  time?: BookingTime;
  serviceId?: ServiceId;
  address?: string;
  /** null clears the note. */
  specialInstructions?: string | null;
};

export type ParseChangesResult =
  | { ok: true; changes: SubscriptionChanges }
  | { ok: false; error: string };

export const NO_CHANGES_MESSAGE = "Choose at least one thing to change.";

function has(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

export function parseSubscriptionChanges(body: Record<string, unknown>): ParseChangesResult {
  const changes: SubscriptionChanges = {};

  if (has(body, "frequency")) {
    if (body.frequency !== "weekly" && body.frequency !== "biweekly") {
      return { ok: false, error: "Choose how often: Weekly or Every 2 Weeks." };
    }
    changes.frequency = body.frequency;
  }

  if (has(body, "preferredDay")) {
    const day = typeof body.preferredDay === "string" ? normalizeDayName(body.preferredDay) : null;
    if (!day) return { ok: false, error: "Choose a day of the week." };
    changes.preferredDay = day;
  }

  if (has(body, "time")) {
    const time = TIME_SLOTS.find((slot) => slot === body.time);
    if (!time) return { ok: false, error: "Choose an arrival time: 9:00 AM or 2:00 PM." };
    changes.time = time;
  }

  if (has(body, "serviceId")) {
    const service = SERVICES.find((item) => item.id === body.serviceId);
    if (!service) return { ok: false, error: "Choose a cleaning service." };
    changes.serviceId = service.id;
  }

  if (has(body, "address")) {
    const address = typeof body.address === "string" ? body.address.trim() : "";
    if (address.length < ADDRESS_MIN_LENGTH || address.length > ADDRESS_MAX_LENGTH) {
      return { ok: false, error: "Enter the full service address." };
    }
    changes.address = address;
  }

  if (Object.prototype.hasOwnProperty.call(body, "specialInstructions")) {
    const note = parseSpecialInstructions(body.specialInstructions);
    if (!note.ok) return { ok: false, error: note.error };
    changes.specialInstructions = note.value;
  }

  if (Object.keys(changes).length === 0) return { ok: false, error: NO_CHANGES_MESSAGE };
  return { ok: true, changes };
}

/** "every week" / "every 2 weeks", as the confirmation message words it. */
export function frequencyLabel(frequency: Frequency) {
  return frequency === "weekly" ? "every week" : "every 2 weeks";
}
