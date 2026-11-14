// AI-02B: the admin's weekly shift draft. "Generate draft" proposes a cleaner
// for every next-week booking no cleaner has accepted; the admin can change
// any job's cleaner, then "Publish draft" makes the assignments real.
//
// Kept out of booking-store.ts so it doesn't clash with other stories that
// edit that file. Its two tables are created here on first use.

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./booking-store.ts";
import { addDaysToDateString, bangkokDateString, getDayOfWeekFromDateString } from "./date-utils.ts";
import {
  WEEKLY_HOUR_CAP,
  hasEnoughTravelTime,
  jobHours,
  totalHours,
  type ShiftJob,
} from "./shift-rules.ts";

export const NO_CLEANER_FLAG = "No cleaner available";
export const NOTHING_TO_SCHEDULE = "Nothing to schedule next week";
export const TRAVEL_TIME_MESSAGE = "Slot unavailable: travel time needed";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const preparedDatabases = new WeakSet<DatabaseSync>();

function db(): DatabaseSync {
  const database = getDatabase();
  if (!preparedDatabases.has(database)) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS shift_drafts (
        id TEXT PRIMARY KEY,
        week_start TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        published_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shift_drafts_week ON shift_drafts (week_start, created_at);
      CREATE TABLE IF NOT EXISTS shift_draft_items (
        draft_id TEXT NOT NULL REFERENCES shift_drafts(id) ON DELETE CASCADE,
        booking_id TEXT NOT NULL,
        cleaner_id TEXT,
        PRIMARY KEY (draft_id, booking_id)
      );
    `);
    preparedDatabases.add(database);
  }
  return database;
}

function inTransaction<T>(work: (database: DatabaseSync) => T): T {
  const database = db();
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = work(database);
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

/** Monday to Sunday of the week after the current Bangkok week. */
export function nextWeek(now: Date = new Date()): { weekStart: string; weekEnd: string } {
  const today = bangkokDateString(now);
  const sinceMonday = (getDayOfWeekFromDateString(today) + 6) % 7;
  const weekStart = addDaysToDateString(today, 7 - sinceMonday);
  return { weekStart, weekEnd: addDaysToDateString(weekStart, 6) };
}

type Cleaner = { id: string; name: string; days: number[] };

type WeekBooking = ShiftJob & {
  id: string;
  serviceName: string;
  customerName: string;
  address: string;
  acceptedById: string | null;
  acceptedByName: string | null;
};

function loadCleaners(database: DatabaseSync): Cleaner[] {
  const rows = database
    .prepare(
      `SELECT cleaners.id, users.name, cleaners.available_days
       FROM users JOIN cleaners ON cleaners.id = users.cleaner_id
       WHERE users.role = 'cleaner' AND users.status = 'active'
       ORDER BY users.name`,
    )
    .all() as Array<{ id: string; name: string; available_days: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    days: (row.available_days ?? "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
  }));
}

function loadWeekBookings(database: DatabaseSync, weekStart: string, weekEnd: string): WeekBooking[] {
  const rows = database
    .prepare(
      `SELECT id, service_date, time_slot, service_id, service_name, name, address,
              accepted_by_id, accepted_by_name
       FROM bookings
       WHERE status = 'scheduled' AND service_date BETWEEN ? AND ?
       ORDER BY service_date, time_slot`,
    )
    .all(weekStart, weekEnd) as Array<{
    id: string;
    service_date: string;
    time_slot: string;
    service_id: string;
    service_name: string;
    name: string;
    address: string;
    accepted_by_id: string | null;
    accepted_by_name: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    date: row.service_date,
    time: row.time_slot,
    serviceId: row.service_id,
    serviceName: row.service_name,
    customerName: row.name,
    address: row.address,
    acceptedById: row.accepted_by_id,
    acceptedByName: row.accepted_by_name,
  }));
}

/**
 * Why `cleaner` can't take `job` given the jobs they already have that week,
 * or null when they can. The same checks are used when drafting, when the
 * admin changes a job's cleaner, and again when the draft is published.
 */
function ruleProblem(cleaner: Cleaner, job: ShiftJob, theirJobs: readonly ShiftJob[]): string | null {
  const weekday = getDayOfWeekFromDateString(job.date);
  if (!cleaner.days.includes(weekday)) {
    return `${cleaner.name} doesn't work on ${DAY_NAMES[weekday]}s.`;
  }
  if (!hasEnoughTravelTime(theirJobs, job)) return TRAVEL_TIME_MESSAGE;
  const hours = totalHours(theirJobs) + jobHours(job.serviceId);
  if (hours > WEEKLY_HOUR_CAP) {
    return `That would give ${cleaner.name} ${hours} hours, over the ${WEEKLY_HOUR_CAP}-hour limit.`;
  }
  return null;
}

/** Jobs each cleaner already has that week (accepted bookings). */
function committedJobs(bookings: readonly WeekBooking[]): Map<string, ShiftJob[]> {
  const jobs = new Map<string, ShiftJob[]>();
  for (const booking of bookings) {
    if (!booking.acceptedById) continue;
    const list = jobs.get(booking.acceptedById) ?? [];
    list.push(booking);
    jobs.set(booking.acceptedById, list);
  }
  return jobs;
}

export type ShiftDraftItem = {
  bookingId: string;
  date: string;
  time: string;
  serviceName: string;
  hours: number;
  customerName: string;
  address: string;
  cleanerId: string | null;
  cleanerName: string | null;
  /** "No cleaner available", "Already accepted by …", "Booking cancelled", or null. */
  flag: string | null;
};

export type ShiftDraftCleaner = {
  id: string;
  name: string;
  /** Accepted hours plus hours given in this draft. */
  hours: number;
  jobs: number;
  workingDays: number[];
};

export type ShiftDraft = {
  id: string;
  weekStart: string;
  weekEnd: string;
  status: "draft" | "published";
  createdAt: string;
  publishedAt: string | null;
  hourCap: number;
  items: ShiftDraftItem[];
  cleaners: ShiftDraftCleaner[];
};

function latestDraftRow(database: DatabaseSync, weekStart: string) {
  return database
    .prepare(
      `SELECT id, week_start, status, created_at, published_at
       FROM shift_drafts WHERE week_start = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(weekStart) as
    | { id: string; week_start: string; status: "draft" | "published"; created_at: string; published_at: string | null }
    | undefined;
}

function buildView(database: DatabaseSync, draftId: string): ShiftDraft | null {
  const row = database
    .prepare("SELECT id, week_start, status, created_at, published_at FROM shift_drafts WHERE id = ?")
    .get(draftId) as
    | { id: string; week_start: string; status: "draft" | "published"; created_at: string; published_at: string | null }
    | undefined;
  if (!row) return null;

  const weekEnd = addDaysToDateString(row.week_start, 6);
  const cleaners = loadCleaners(database);
  const cleanerById = new Map(cleaners.map((cleaner) => [cleaner.id, cleaner]));
  const bookings = loadWeekBookings(database, row.week_start, weekEnd);
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const draftItems = database
    .prepare("SELECT booking_id, cleaner_id FROM shift_draft_items WHERE draft_id = ?")
    .all(draftId) as Array<{ booking_id: string; cleaner_id: string | null }>;

  // Hours: jobs accepted for real, plus (while still a draft) jobs this draft gives.
  const jobsByCleaner = committedJobs(bookings);
  const items: ShiftDraftItem[] = [];
  for (const item of draftItems) {
    const booking = bookingById.get(item.booking_id);
    if (!booking) {
      items.push({
        bookingId: item.booking_id,
        date: "",
        time: "",
        serviceName: "",
        hours: 0,
        customerName: "",
        address: "",
        cleanerId: item.cleaner_id,
        cleanerName: item.cleaner_id ? cleanerById.get(item.cleaner_id)?.name ?? null : null,
        flag: "Booking cancelled",
      });
      continue;
    }
    let flag: string | null = null;
    if (row.status === "published") {
      if (item.cleaner_id && booking.acceptedById !== item.cleaner_id) {
        flag = booking.acceptedById
          ? `Accepted by ${booking.acceptedByName ?? "another cleaner"}`
          : "Not assigned when published";
      } else if (!item.cleaner_id && !booking.acceptedById) {
        flag = NO_CLEANER_FLAG;
      }
    } else if (booking.acceptedById && booking.acceptedById !== item.cleaner_id) {
      flag = `Already accepted by ${booking.acceptedByName ?? "another cleaner"}`;
    } else if (!item.cleaner_id) {
      flag = NO_CLEANER_FLAG;
    } else if (!booking.acceptedById) {
      const list = jobsByCleaner.get(item.cleaner_id) ?? [];
      list.push(booking);
      jobsByCleaner.set(item.cleaner_id, list);
    }
    items.push({
      bookingId: booking.id,
      date: booking.date,
      time: booking.time,
      serviceName: booking.serviceName,
      hours: jobHours(booking.serviceId),
      customerName: booking.customerName,
      address: booking.address,
      cleanerId: item.cleaner_id,
      cleanerName: item.cleaner_id ? cleanerById.get(item.cleaner_id)?.name ?? null : null,
      flag,
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  return {
    id: row.id,
    weekStart: row.week_start,
    weekEnd,
    status: row.status,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    hourCap: WEEKLY_HOUR_CAP,
    items,
    cleaners: cleaners.map((cleaner) => {
      const jobs = jobsByCleaner.get(cleaner.id) ?? [];
      return {
        id: cleaner.id,
        name: cleaner.name,
        hours: totalHours(jobs),
        jobs: jobs.length,
        workingDays: cleaner.days,
      };
    }),
  };
}

/** The latest draft for next week (draft or published), or null if none was made. */
export function getShiftDraft(now: Date = new Date()): ShiftDraft | null {
  const database = db();
  const row = latestDraftRow(database, nextWeek(now).weekStart);
  return row ? buildView(database, row.id) : null;
}

export type GenerateResult =
  | { status: "created"; draft: ShiftDraft; assigned: number; flagged: number }
  | { status: "empty"; message: string };

/**
 * AC 1 + 2: drafts a cleaner for every next-week booking no cleaner has
 * accepted. Jobs go in date and time order; each goes to the eligible cleaner
 * with the fewest hours so far (then fewest jobs, then name), so work is
 * shared fairly. Eligible = works that weekday, passes the travel-time rule
 * and stays within the weekly hour cap. A job nobody can take is flagged
 * "No cleaner available". Replaces any unpublished draft for that week.
 */
export function generateShiftDraft(adminName: string, now: Date = new Date()): GenerateResult {
  return inTransaction((database) => {
    const { weekStart, weekEnd } = nextWeek(now);
    const bookings = loadWeekBookings(database, weekStart, weekEnd);
    const open = bookings.filter((booking) => !booking.acceptedById);
    if (open.length === 0) return { status: "empty" as const, message: NOTHING_TO_SCHEDULE };

    const cleaners = loadCleaners(database);
    const jobsByCleaner = committedJobs(bookings);
    const plan: Array<{ bookingId: string; cleanerId: string | null }> = [];
    for (const job of open) {
      const candidates = cleaners
        .filter((cleaner) => ruleProblem(cleaner, job, jobsByCleaner.get(cleaner.id) ?? []) === null)
        .map((cleaner) => {
          const jobs = jobsByCleaner.get(cleaner.id) ?? [];
          return { cleaner, hours: totalHours(jobs), count: jobs.length };
        })
        .sort(
          (a, b) =>
            a.hours - b.hours || a.count - b.count || a.cleaner.name.localeCompare(b.cleaner.name),
        );
      const pick = candidates[0]?.cleaner ?? null;
      if (pick) {
        const list = jobsByCleaner.get(pick.id) ?? [];
        list.push(job);
        jobsByCleaner.set(pick.id, list);
      }
      plan.push({ bookingId: job.id, cleanerId: pick?.id ?? null });
    }

    database
      .prepare("DELETE FROM shift_draft_items WHERE draft_id IN (SELECT id FROM shift_drafts WHERE week_start = ? AND status = 'draft')")
      .run(weekStart);
    database.prepare("DELETE FROM shift_drafts WHERE week_start = ? AND status = 'draft'").run(weekStart);

    const draftId = randomUUID();
    database
      .prepare("INSERT INTO shift_drafts (id, week_start, status, created_at, created_by) VALUES (?, ?, 'draft', ?, ?)")
      .run(draftId, weekStart, now.toISOString(), adminName);
    const insert = database.prepare(
      "INSERT INTO shift_draft_items (draft_id, booking_id, cleaner_id) VALUES (?, ?, ?)",
    );
    for (const item of plan) insert.run(draftId, item.bookingId, item.cleanerId);

    const draft = buildView(database, draftId)!;
    const flagged = plan.filter((item) => item.cleanerId === null).length;
    return { status: "created" as const, draft, assigned: plan.length - flagged, flagged };
  });
}

export type ChangeResult =
  | { status: "ok"; draft: ShiftDraft }
  | { status: "no-draft" }
  | { status: "published" }
  | { status: "not-in-draft" }
  | { status: "unknown-cleaner" }
  | { status: "refused"; error: string };

/**
 * AC 3: the admin changes one job's cleaner in the unpublished draft (or
 * clears it with null). Refused if the new cleaner would break the weekday,
 * travel-time or hour rule.
 */
export function changeDraftCleaner(
  bookingId: string,
  cleanerId: string | null,
  now: Date = new Date(),
): ChangeResult {
  return inTransaction((database) => {
    const { weekStart, weekEnd } = nextWeek(now);
    const row = latestDraftRow(database, weekStart);
    if (!row) return { status: "no-draft" as const };
    if (row.status === "published") return { status: "published" as const };

    const item = database
      .prepare("SELECT cleaner_id FROM shift_draft_items WHERE draft_id = ? AND booking_id = ?")
      .get(row.id, bookingId) as { cleaner_id: string | null } | undefined;
    if (!item) return { status: "not-in-draft" as const };

    if (cleanerId !== null) {
      const cleaner = loadCleaners(database).find((entry) => entry.id === cleanerId);
      if (!cleaner) return { status: "unknown-cleaner" as const };

      const bookings = loadWeekBookings(database, weekStart, weekEnd);
      const job = bookings.find((booking) => booking.id === bookingId);
      if (!job) return { status: "refused" as const, error: "This booking was cancelled." };
      if (job.acceptedById) {
        return {
          status: "refused" as const,
          error: `${job.acceptedByName ?? "A cleaner"} has already accepted this job.`,
        };
      }

      // The cleaner's week: accepted jobs plus the other jobs this draft gives them.
      const others = database
        .prepare(
          "SELECT booking_id FROM shift_draft_items WHERE draft_id = ? AND cleaner_id = ? AND booking_id <> ?",
        )
        .all(row.id, cleanerId, bookingId) as Array<{ booking_id: string }>;
      const otherIds = new Set(others.map((entry) => entry.booking_id));
      const theirJobs = bookings.filter(
        (booking) =>
          booking.acceptedById === cleanerId || (!booking.acceptedById && otherIds.has(booking.id)),
      );
      const problem = ruleProblem(cleaner, job, theirJobs);
      if (problem) return { status: "refused" as const, error: problem };
    }

    database
      .prepare("UPDATE shift_draft_items SET cleaner_id = ? WHERE draft_id = ? AND booking_id = ?")
      .run(cleanerId, row.id, bookingId);
    return { status: "ok" as const, draft: buildView(database, row.id)! };
  });
}

export type PublishResult =
  | { status: "published"; draft: ShiftDraft; assigned: number; skipped: Array<{ bookingId: string; reason: string }> }
  | { status: "no-draft" }
  | { status: "already-published" };

/**
 * Makes the draft's assignments real, in one transaction. Each job is checked
 * again first: a job that was cancelled, accepted by someone meanwhile, or
 * that now breaks a rule (for example the cleaner changed their days) is
 * skipped and reported, not assigned. Flagged jobs stay open requests.
 */
export function publishShiftDraft(now: Date = new Date()): PublishResult {
  return inTransaction((database) => {
    const { weekStart, weekEnd } = nextWeek(now);
    const row = latestDraftRow(database, weekStart);
    if (!row) return { status: "no-draft" as const };
    if (row.status === "published") return { status: "already-published" as const };

    const cleaners = new Map(loadCleaners(database).map((cleaner) => [cleaner.id, cleaner]));
    const bookings = loadWeekBookings(database, weekStart, weekEnd);
    const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
    const jobsByCleaner = committedJobs(bookings);
    const items = database
      .prepare("SELECT booking_id, cleaner_id FROM shift_draft_items WHERE draft_id = ? AND cleaner_id IS NOT NULL")
      .all(row.id) as Array<{ booking_id: string; cleaner_id: string }>;
    items.sort((a, b) => {
      const x = bookingById.get(a.booking_id);
      const y = bookingById.get(b.booking_id);
      return (x?.date ?? "").localeCompare(y?.date ?? "") || (x?.time ?? "").localeCompare(y?.time ?? "");
    });

    const assign = database.prepare(
      `UPDATE bookings
       SET cleaner_id = ?, accepted_by_id = ?, accepted_by_name = ?, accepted_at = ?
       WHERE id = ? AND accepted_by_id IS NULL AND status = 'scheduled'`,
    );
    const skipped: Array<{ bookingId: string; reason: string }> = [];
    let assigned = 0;
    for (const item of items) {
      const booking = bookingById.get(item.booking_id);
      const cleaner = cleaners.get(item.cleaner_id);
      if (!booking) {
        skipped.push({ bookingId: item.booking_id, reason: "Booking cancelled" });
        continue;
      }
      if (booking.acceptedById) {
        skipped.push({ bookingId: booking.id, reason: `Already accepted by ${booking.acceptedByName ?? "another cleaner"}` });
        continue;
      }
      if (!cleaner) {
        skipped.push({ bookingId: booking.id, reason: "The cleaner's account is no longer active" });
        continue;
      }
      const theirJobs = jobsByCleaner.get(cleaner.id) ?? [];
      const problem = ruleProblem(cleaner, booking, theirJobs);
      if (problem) {
        skipped.push({ bookingId: booking.id, reason: problem });
        continue;
      }
      assign.run(cleaner.id, cleaner.id, cleaner.name, now.toISOString(), booking.id);
      theirJobs.push(booking);
      jobsByCleaner.set(cleaner.id, theirJobs);
      assigned += 1;
    }

    database
      .prepare("UPDATE shift_drafts SET status = 'published', published_at = ? WHERE id = ?")
      .run(now.toISOString(), row.id);
    return { status: "published" as const, draft: buildView(database, row.id)!, assigned, skipped };
  });
}
