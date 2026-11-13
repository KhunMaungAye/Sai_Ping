// AI-02A: a cleaner needs travel time between jobs. A job runs from its start
// time for the length of its service (Essential 2h, Deep 3h, Move-out 4h — the
// same lengths US-07 shows cleaners). The next job may start no earlier than
// 60 minutes after the previous one ends; exactly 60 minutes is fine.
// No database code, so the store, the API and node tests share one rule.

import { SERVICE_SPECS } from "./service-specs.ts";
import type { ServiceId } from "./services.ts";

/** Minimum gap between two jobs on the same day. (60 minutes: PO to confirm.) */
export const TRAVEL_TIME_MINUTES = 60;

export const TRAVEL_TIME_BLOCKED_MESSAGE = "Slot unavailable: travel time needed";

export type TimedJob = {
  /** YYYY-MM-DD */
  date: string;
  /** "HH:MM" arrival time */
  time: string;
  serviceId: ServiceId;
};

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** AC1: when a job starts and ends, in minutes after midnight. */
export function jobWindow(job: Pick<TimedJob, "time" | "serviceId">) {
  const start = minutesOf(job.time);
  return { start, end: start + SERVICE_SPECS[job.serviceId].hours * 60 };
}

/**
 * AC2/AC3: true when two jobs leave less than TRAVEL_TIME_MINUTES between the
 * end of the earlier one and the start of the later one. Jobs on different days
 * never conflict, and a gap of exactly TRAVEL_TIME_MINUTES is allowed.
 */
export function tooClose(a: TimedJob, b: TimedJob): boolean {
  if (a.date !== b.date) return false;
  const first = jobWindow(a);
  const second = jobWindow(b);
  return (
    second.start < first.end + TRAVEL_TIME_MINUTES &&
    first.start < second.end + TRAVEL_TIME_MINUTES
  );
}

/** The first of a cleaner's existing jobs that `candidate` would be too close to, if any. */
export function findTravelConflict<T extends TimedJob>(candidate: TimedJob, existing: readonly T[]): T | null {
  return existing.find((job) => tooClose(candidate, job)) ?? null;
}
