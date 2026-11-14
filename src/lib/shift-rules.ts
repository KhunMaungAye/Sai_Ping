// AI-02B: scheduling rules for the weekly shift draft. No database code, so the
// admin page and node tests can both use them.
//
// STAND-IN for AI-02A ("Block jobs without enough travel time", Thida's card):
// `hasEnoughTravelTime` follows the AI-02A card exactly (job length by service,
// at least 60 minutes between one job's end and the next job's start, exactly
// 60 allowed, different days never clash). When AI-02A is merged, replace the
// body of `hasEnoughTravelTime` with a call to AI-02A's rule so both cards use
// one implementation.

/** How long each service takes, in hours (AI-02A AC 1). */
export const SERVICE_HOURS: Record<string, number> = {
  essential: 2,
  deep: 3,
  "move-out": 4,
};

/** Minimum travel time between two jobs on the same day (AI-02A AC 2). */
export const TRAVEL_MINUTES = 60;

/** Most working hours one cleaner can get in a week (AI-02B AC 2, PO to confirm). */
export const WEEKLY_HOUR_CAP = 35;

export type ShiftJob = {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  serviceId: string;
};

/** Hours a job takes; an unknown service counts as the longest one, to stay safe. */
export function jobHours(serviceId: string): number {
  return SERVICE_HOURS[serviceId] ?? Math.max(...Object.values(SERVICE_HOURS));
}

function startMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/**
 * True when `candidate` leaves at least TRAVEL_MINUTES between it and every
 * other job the cleaner has that day (before or after it). Overlapping jobs
 * always fail.
 */
export function hasEnoughTravelTime(existing: readonly ShiftJob[], candidate: ShiftJob): boolean {
  const start = startMinutes(candidate.time);
  const end = start + jobHours(candidate.serviceId) * 60;
  return existing
    .filter((job) => job.date === candidate.date)
    .every((job) => {
      const otherStart = startMinutes(job.time);
      const otherEnd = otherStart + jobHours(job.serviceId) * 60;
      return otherEnd + TRAVEL_MINUTES <= start || end + TRAVEL_MINUTES <= otherStart;
    });
}

/** Total hours of a set of jobs. */
export function totalHours(jobs: readonly ShiftJob[]): number {
  return jobs.reduce((sum, job) => sum + jobHours(job.serviceId), 0);
}
