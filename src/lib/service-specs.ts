// US-07: what a cleaner needs to prepare for a job — the schedule (start,
// estimated finish, length) and the service specs (what's included, what to
// bring). No database code, so the cleaner page, the API and node tests share it.

import { SERVICES, type ServiceId } from "./services.ts";

export type ServiceSpec = {
  /** Job length in whole hours; matches the "duration" text in SERVICES. */
  hours: number;
  /** What the cleaner does on this service. (Task lists: PO to confirm.) */
  includes: readonly string[];
  /** What the cleaner should bring. (Supply lists: PO to confirm.) */
  bring: readonly string[];
};

export const SERVICE_SPECS: Record<ServiceId, ServiceSpec> = {
  essential: {
    hours: 2,
    includes: [
      "Dust surfaces and furniture in the main rooms",
      "Vacuum and mop all floors",
      "Clean and disinfect the bathroom",
      "Wipe kitchen counters, sink and stovetop",
      "Empty the bins and replace liners",
    ],
    bring: ["All-purpose cleaner", "Microfibre cloths", "Mop and bucket", "Bin liners"],
  },
  deep: {
    hours: 3,
    includes: [
      "Everything in the Essential clean",
      "Degrease the kitchen: hood, tiles and the outside of appliances",
      "Descale the bathroom: shower, taps and tile grout",
      "Clean inside the microwave and fridge",
      "Wipe skirting boards, door frames and light switches",
    ],
    bring: [
      "All-purpose cleaner",
      "Degreaser and descaler",
      "Microfibre cloths and scrub brushes",
      "Mop and bucket",
      "Rubber gloves",
    ],
  },
  "move-out": {
    hours: 4,
    includes: [
      "Everything in the Deep clean",
      "Clean inside cupboards, drawers and wardrobes",
      "Clean inside the oven",
      "Wash windows on the inside and wipe the tracks",
      "Final check of every room so it is ready to hand over",
    ],
    bring: [
      "All-purpose cleaner",
      "Degreaser, descaler and oven cleaner",
      "Window squeegee and glass cleaner",
      "Microfibre cloths and scrub brushes",
      "Mop, bucket and a step stool",
      "Rubber gloves",
    ],
  },
};

export type JobPreparation = {
  serviceName: string;
  /** "09:00" */
  start: string;
  /** Estimated finish, "11:00". */
  end: string;
  /** "2 hours" */
  length: string;
  includes: readonly string[];
  bring: readonly string[];
};

/** "09:00" + 2 hours -> "11:00" (arrival windows are on the hour, jobs end the same day). */
export function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The schedule and service specs for one job, from its service and arrival time. */
export function jobPreparation(serviceId: ServiceId, time: string): JobPreparation {
  const spec = SERVICE_SPECS[serviceId];
  const service = SERVICES.find((item) => item.id === serviceId)!;
  return {
    serviceName: service.name,
    start: time,
    end: addHours(time, spec.hours),
    length: `${spec.hours} hour${spec.hours === 1 ? "" : "s"}`,
    includes: spec.includes,
    bring: spec.bring,
  };
}
