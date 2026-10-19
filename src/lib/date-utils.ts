export type Frequency = "weekly" | "biweekly";

export const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type DayOfWeekName = (typeof DAYS_OF_WEEK)[number];

export function normalizeDayName(value: string): DayOfWeekName | null {
  if (!value || typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  const index = DAYS_OF_WEEK.findIndex((d) => d.toLowerCase() === lower);
  return index >= 0 ? DAYS_OF_WEEK[index] : null;
}

/**
 * Add days to a YYYY-MM-DD date string using pure UTC Gregorian arithmetic.
 * Completely immune to local timezone and daylight saving time (DST) shifts.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  const utcDate = new Date(Date.UTC(year, month, day + days));
  const y = utcDate.getUTCFullYear();
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDayOfWeekFromDateString(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return utcDate.getUTCDay();
}

export function getDayNameFromDateString(dateStr: string): DayOfWeekName {
  const dayIndex = getDayOfWeekFromDateString(dateStr);
  return DAYS_OF_WEEK[dayIndex];
}

/**
 * Compute the next scheduled service date on or after startDate that falls on preferredDay.
 * If preferredDay is omitted or matches startDate, returns startDate.
 */
export function getNextServiceDate(
  startDate: string,
  preferredDay?: string,
): string {
  if (!startDate) return "";
  if (!preferredDay) return startDate;
  const targetDayName = normalizeDayName(preferredDay);
  if (!targetDayName) return startDate;
  const targetDay = DAYS_OF_WEEK.indexOf(targetDayName);
  const currentDay = getDayOfWeekFromDateString(startDate);
  const daysToAdd = (targetDay - currentDay + 7) % 7;
  return addDaysToDateString(startDate, daysToAdd);
}

/**
 * Generate all recurring dates starting from startDate (aligned with preferredDay)
 * at the given frequency (weekly = 7 days, biweekly = 14 days) up to endDate or occurrences count.
 */
export function generateRecurringDates({
  startDate,
  frequency,
  endDate,
  occurrences = 4,
  preferredDay,
  maxOccurrences = 52,
}: {
  startDate: string;
  frequency: Frequency;
  endDate?: string | null;
  occurrences?: number;
  preferredDay?: string;
  maxOccurrences?: number;
}): string[] {
  if (!startDate) return [];
  const firstDate = getNextServiceDate(startDate, preferredDay);
  const stepDays = frequency === "weekly" ? 7 : 14;
  const dates: string[] = [];
  let currentDate = firstDate;

  if (endDate) {
    while (currentDate <= endDate && dates.length < maxOccurrences) {
      dates.push(currentDate);
      currentDate = addDaysToDateString(currentDate, stepDays);
    }
  } else {
    const count = Math.min(Math.max(1, occurrences), maxOccurrences);
    for (let i = 0; i < count; i++) {
      dates.push(currentDate);
      currentDate = addDaysToDateString(currentDate, stepDays);
    }
  }

  return dates;
}

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isBookableDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= localDateString()
  );
}
