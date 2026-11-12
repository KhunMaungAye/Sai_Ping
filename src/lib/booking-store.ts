import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SERVICES,
  TIME_SLOTS,
  isWithinCancellationWindow,
  type BookingTime,
  type ServiceId,
} from "./services.ts";

export { SERVICES, TIME_SLOTS, type BookingTime, type ServiceId };
import {
  addDaysToDateString,
  DAYS_OF_WEEK,
  generateRecurringDates,
  getDayNameFromDateString,
  getDayOfWeekFromDateString,
  getNextServiceDate,
  isBookableDate,
  localDateString,
  normalizeDayName,
  type DayOfWeekName,
  type Frequency,
} from "./date-utils.ts";

export {
  addDaysToDateString,
  DAYS_OF_WEEK,
  generateRecurringDates,
  getDayNameFromDateString,
  getDayOfWeekFromDateString,
  getNextServiceDate,
  isBookableDate,
  localDateString,
  normalizeDayName,
  type DayOfWeekName,
  type Frequency,
};

export type BookingInput = {
  name: string;
  email: string;
  serviceId: ServiceId;
  date: string;
  time: BookingTime;
  address: string;
  specialInstructions?: string | null;
};

export type Booking = BookingInput & {
  id: string;
  serviceName: string;
  priceCents: number;
  createdAt: string;
  cleanerName: string;
  subscriptionId?: string | null;
};

export type CustomerBooking = {
  id: string;
  name: string;
  email: string;
  serviceId: ServiceId;
  serviceName: string;
  priceCents: number;
  date: string;
  time: BookingTime;
  address: string;
  specialInstructions: string | null;
  createdAt: string;
  cleanerId: string;
  cleanerName: string;
  acceptedById?: string | null;
  acceptedByName?: string | null;
  acceptedAt?: string | null;
  isAccepted?: boolean;
  status: "scheduled" | "completed";
  statusLabel: string;
  subscriptionId: string | null;
  rating: number | null;
  review: string | null;
  isUpcoming: boolean;
  /** US-05: true when the customer may cancel this booking right now. */
  canCancel?: boolean;
};

/** US-05: a booking the customer cancelled, kept for their history. */
export type CancelledBooking = {
  id: string;
  serviceName: string;
  priceCents: number;
  date: string;
  time: BookingTime;
  address: string;
  cancelledAt: string;
};

export type CancelBookingResult =
  | { status: "cancelled"; booking: CancelledBooking; message: string }
  | { status: "already-cancelled"; booking: CancelledBooking; message: string }
  | { status: "not-found" }
  | { status: "completed" }
  | { status: "recurring" }
  | { status: "too-late" };

export type BookingRatingDetails = {
  id: string;
  serviceName: string;
  date: string;
  status: "scheduled" | "completed";
  cleanerId: string;
  cleanerName: string;
  customerEmail: string;
  isAccepted: boolean;
  rating: number | null;
  review: string | null;
};

export type SubscriptionInput = {
  name: string;
  email: string;
  serviceId: ServiceId;
  address: string;
  specialInstructions?: string | null;
  frequency: Frequency;
  preferredDay?: string;
  startDate: string;
  endDate?: string | null;
  occurrences?: number;
  time: BookingTime;
  idempotencyKey?: string;
};

export type Subscription = {
  id: string;
  name: string;
  email: string;
  address: string;
  serviceId: ServiceId;
  serviceName: string;
  priceCents: number;
  frequency: Frequency;
  preferredDay: string;
  startDate: string;
  endDate: string | null;
  time: BookingTime;
  cleanerName: string;
  createdAt: string;
  status: "active" | "cancelled";
  idempotencyKey?: string | null;
  nextServiceDate: string;
  scheduledCount?: number;
};

export type RecurringBookingResult =
  | {
      status: "created";
      subscription: Subscription;
      bookings: Booking[];
      isDuplicate?: boolean;
    }
  | {
      status: "conflict";
      conflictDate: string;
      time: BookingTime;
      error: string;
    };

export const DEFAULT_CLEANER = {
  id: "cleaner-001",
  name: "Sai Ping Cleaning Team",
} as const;

/** Weekdays (0 = Sunday … 6 = Saturday) a new cleaner works unless they change it. */
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

type StoredBooking = {
  id: string;
  name: string;
  email: string;
  service_id: ServiceId;
  service_name: string;
  price_cents: number;
  service_date: string;
  time_slot: BookingTime;
  address: string;
  special_instructions?: string | null;
  created_at: string;
  cleaner_id: string;
  cleaner_name: string;
  status: "scheduled" | "completed";
  subscription_id?: string | null;
};

type StoredSubscription = {
  id: string;
  name: string;
  email: string;
  address: string;
  service_id: ServiceId;
  service_name: string;
  price_cents: number;
  frequency: Frequency;
  preferred_day: string;
  start_date: string;
  end_date: string | null;
  time_slot: BookingTime;
  cleaner_id: string;
  cleaner_name: string;
  idempotency_key: string | null;
  created_at: string;
  status: "active" | "cancelled";
};

const globalForSqlite = globalThis as typeof globalThis & {
  cleaningDatabase?: DatabaseSync;
};

function initDatabaseSchema(database: DatabaseSync) {
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS cleaners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    INSERT OR IGNORE INTO cleaners (id, name)
    VALUES ('${DEFAULT_CLEANER.id}', '${DEFAULT_CLEANER.name}');

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      service_date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      address TEXT NOT NULL,
      special_instructions TEXT,
      created_at TEXT NOT NULL,
      cleaner_id TEXT NOT NULL DEFAULT '${DEFAULT_CLEANER.id}' REFERENCES cleaners(id),
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed')),
      accepted_by_id TEXT,
      accepted_by_name TEXT,
      accepted_at TEXT,
      UNIQUE (service_date, time_slot)
    );
  `);

  const bookingColumns = database
    .prepare("PRAGMA table_info(bookings)")
    .all() as { name: string }[];

  if (!bookingColumns.some((column) => column.name === "cleaner_id")) {
    database.exec(
      `ALTER TABLE bookings ADD COLUMN cleaner_id TEXT NOT NULL DEFAULT '${DEFAULT_CLEANER.id}';`,
    );
  }
  if (!bookingColumns.some((column) => column.name === "status")) {
    database.exec(
      "ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled';",
    );
  }
  if (!bookingColumns.some((column) => column.name === "subscription_id")) {
    database.exec("ALTER TABLE bookings ADD COLUMN subscription_id TEXT;");
  }
  if (!bookingColumns.some((column) => column.name === "accepted_by_id")) {
    database.exec("ALTER TABLE bookings ADD COLUMN accepted_by_id TEXT;");
  }
  if (!bookingColumns.some((column) => column.name === "accepted_by_name")) {
    database.exec("ALTER TABLE bookings ADD COLUMN accepted_by_name TEXT;");
  }
  if (!bookingColumns.some((column) => column.name === "accepted_at")) {
    database.exec("ALTER TABLE bookings ADD COLUMN accepted_at TEXT;");
  }
  // US-13: optional note from the customer for the cleaner (max 250 chars)
  if (!bookingColumns.some((column) => column.name === "special_instructions")) {
    database.exec("ALTER TABLE bookings ADD COLUMN special_instructions TEXT;");
  }

  const cleanerColumns = database
    .prepare("PRAGMA table_info(cleaners)")
    .all() as { name: string }[];
  if (!cleanerColumns.some((column) => column.name === "available_days")) {
    database.exec(
      `ALTER TABLE cleaners ADD COLUMN available_days TEXT NOT NULL DEFAULT '${ALL_WEEKDAYS.join(",")}';`,
    );
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
      cleaner_id TEXT NOT NULL REFERENCES cleaners(id),
      stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      address TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly')),
      preferred_day TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      time_slot TEXT NOT NULL,
      cleaner_id TEXT NOT NULL DEFAULT '${DEFAULT_CLEANER.id}' REFERENCES cleaners(id),
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled'))
    );

    CREATE TABLE IF NOT EXISTS customer_sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'cleaner', 'admin')),
      cleaner_id TEXT REFERENCES cleaners(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'cleaner', 'admin')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- The single admin account. Customers and cleaners sign themselves up
    -- through /api/auth/register; tests seed demo users via tests/helpers.
    INSERT OR IGNORE INTO users (id, email, password_hash, name, role, cleaner_id, status, created_at)
    VALUES
      ('user-admin-001', 'admin@saiping.com', '$2b$10$qDP8DUieLBSw2LaudMy.0e4IKK3ssHw21I/VdyuLcsI0425P3zTzm', 'System Administrator', 'admin', NULL, 'active', '2026-01-01T00:00:00.000Z');
  `);

  const ratingColumns = database
    .prepare("PRAGMA table_info(ratings)")
    .all() as { name: string }[];
  if (!ratingColumns.some((column) => column.name === "review")) {
    database.exec("ALTER TABLE ratings ADD COLUMN review TEXT;");
  }

  // US-15: pausing and skipping recurring cleanings
  const subscriptionColumns = database
    .prepare("PRAGMA table_info(subscriptions)")
    .all() as { name: string }[];
  if (!subscriptionColumns.some((column) => column.name === "paused_until")) {
    database.exec("ALTER TABLE subscriptions ADD COLUMN paused_until TEXT;");
  }
  if (!subscriptionColumns.some((column) => column.name === "paused_at")) {
    database.exec("ALTER TABLE subscriptions ADD COLUMN paused_at TEXT;");
  }
  // One row per visit a customer skipped or paused. The visit's booking is
  // removed (so it is never charged and its slot is freed); this row keeps the
  // record, stops the same date being skipped twice, and lets "resume" put
  // paused visits back.
  database.exec(`
    CREATE TABLE IF NOT EXISTS subscription_skips (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
      service_date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('skip', 'pause')),
      created_at TEXT NOT NULL,
      UNIQUE (subscription_id, service_date)
    );
  `);

  // US-05: a cancelled booking is moved here and removed from `bookings`, so
  // its arrival window (UNIQUE service_date + time_slot) is free to book again
  // while the customer still sees the cancellation in their history.
  database.exec(`
    CREATE TABLE IF NOT EXISTS cancelled_bookings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      service_date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      address TEXT NOT NULL,
      special_instructions TEXT,
      accepted_by_id TEXT,
      accepted_by_name TEXT,
      created_at TEXT NOT NULL,
      cancelled_at TEXT NOT NULL
    );
  `);
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_cancelled_bookings_email ON cancelled_bookings (LOWER(email), cancelled_at);",
  );
}

export function getDatabase(customPath?: string) {
  if (customPath) {
    const database = new DatabaseSync(customPath);
    initDatabaseSchema(database);
    return database;
  }

  if (!globalForSqlite.cleaningDatabase) {
    const dbPath =
      process.env.DATABASE_PATH ||
      path.join(process.cwd(), "data", "bookings.sqlite");

    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    const database = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:") {
      database.exec("PRAGMA journal_mode = WAL;");
    }
    initDatabaseSchema(database);
    globalForSqlite.cleaningDatabase = database;
  }

  return globalForSqlite.cleaningDatabase;
}

export function resetDatabaseForTesting(db?: DatabaseSync) {
  if (globalForSqlite.cleaningDatabase) {
    try {
      globalForSqlite.cleaningDatabase.close();
    } catch {}
    delete globalForSqlite.cleaningDatabase;
  }
  if (db) {
    initDatabaseSchema(db);
    globalForSqlite.cleaningDatabase = db;
  }
}

export function isServiceId(value: unknown): value is ServiceId {
  return (
    typeof value === "string" &&
    SERVICES.some((service) => service.id === value)
  );
}

export function isBookableTime(
  date: string,
  value: unknown,
): value is BookingTime {
  if (typeof value !== "string" || !TIME_SLOTS.some((slot) => slot === value))
    return false;
  if (date !== localDateString()) return true;

  const [hour, minute] = value.split(":").map(Number);
  const now = new Date();
  return hour * 60 + minute > now.getHours() * 60 + now.getMinutes();
}

function parseWeekdays(value: string | null | undefined): number[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ].sort((a, b) => a - b);
}

export function getCleanerAvailableDays(cleanerId: string): number[] {
  const row = getDatabase()
    .prepare("SELECT available_days FROM cleaners WHERE id = ?")
    .get(cleanerId) as { available_days: string } | undefined;
  return parseWeekdays(row?.available_days);
}

export function setCleanerAvailableDays(
  cleanerId: string,
  days: number[],
): number[] {
  const normalized = parseWeekdays(days.join(","));
  getDatabase()
    .prepare("UPDATE cleaners SET available_days = ? WHERE id = ?")
    .run(normalized.join(","), cleanerId);
  return normalized;
}

/**
 * Weekdays covered by at least one active cleaner account.
 * Customers can only book a date that falls on one of these days.
 */
export function getServicedWeekdays(): Set<number> {
  const rows = getDatabase()
    .prepare(
      `SELECT cleaners.available_days
       FROM users
       JOIN cleaners ON cleaners.id = users.cleaner_id
       WHERE users.role = 'cleaner' AND users.status = 'active'`,
    )
    .all() as { available_days: string }[];

  const days = new Set<number>();
  for (const row of rows) {
    for (const day of parseWeekdays(row.available_days)) days.add(day);
  }
  return days;
}

export function isServiceDayAvailable(date: string) {
  return getServicedWeekdays().has(getDayOfWeekFromDateString(date));
}

export type AvailableDay = {
  date: string;
  dayName: DayOfWeekName;
  availableSlots: BookingTime[];
};

/** Upcoming dates with their open arrival windows, for the customer day picker. */
export function listAvailableDays(
  startDate = localDateString(),
  count = 21,
): AvailableDay[] {
  const days: AvailableDay[] = [];
  for (let offset = 0; offset < count; offset++) {
    const date = addDaysToDateString(startDate, offset);
    days.push({
      date,
      dayName: getDayNameFromDateString(date),
      availableSlots: listAvailableSlots(date),
    });
  }
  return days;
}

export function listAvailableSlots(date: string): BookingTime[] {
  if (!isServiceDayAvailable(date)) return [];

  const rows = getDatabase()
    .prepare("SELECT time_slot FROM bookings WHERE service_date = ?")
    .all(date) as { time_slot: string }[];
  const bookedTimes = new Set(rows.map((row) => row.time_slot));

  return TIME_SLOTS.filter(
    (time) => !bookedTimes.has(time) && isBookableTime(date, time),
  );
}

export function checkRecurringAvailability({
  startDate,
  frequency,
  time,
  endDate,
  occurrences = 4,
  preferredDay,
}: {
  startDate: string;
  frequency: Frequency;
  time: BookingTime;
  endDate?: string | null;
  occurrences?: number;
  preferredDay?: string;
}) {
  const database = getDatabase();
  const nextServiceDate = getNextServiceDate(startDate, preferredDay);
  const dates = generateRecurringDates({
    startDate,
    frequency,
    endDate,
    occurrences,
    preferredDay,
  });

  const servicedDays = getServicedWeekdays();
  for (const date of dates) {
    const existing = database
      .prepare(
        "SELECT id FROM bookings WHERE service_date = ? AND time_slot = ?",
      )
      .get(date, time);
    if (existing || !servicedDays.has(getDayOfWeekFromDateString(date))) {
      return {
        available: false,
        conflictDate: date,
        nextServiceDate,
        dates,
      };
    }
  }

  return {
    available: true,
    conflictDate: null,
    nextServiceDate,
    dates,
  };
}

function toBooking(row: StoredBooking): Booking {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    serviceId: row.service_id,
    serviceName: row.service_name,
    priceCents: row.price_cents,
    date: row.service_date,
    time: row.time_slot,
    address: row.address,
    specialInstructions: row.special_instructions ?? null,
    createdAt: row.created_at,
    cleanerName: row.cleaner_name,
    subscriptionId: row.subscription_id ?? null,
  };
}

function toSubscription(
  row: StoredSubscription,
  cleanerName: string,
  nextServiceDate: string,
): Subscription {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    address: row.address,
    serviceId: row.service_id,
    serviceName: row.service_name,
    priceCents: row.price_cents,
    frequency: row.frequency,
    preferredDay: row.preferred_day,
    startDate: row.start_date,
    endDate: row.end_date,
    time: row.time_slot,
    cleanerName: cleanerName || row.cleaner_name,
    createdAt: row.created_at,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    nextServiceDate,
  };
}

export function createBooking(input: BookingInput) {
  const database = getDatabase();
  const service = SERVICES.find((item) => item.id === input.serviceId);
  const cleaner = database
    .prepare("SELECT id, name FROM cleaners WHERE id = ?")
    .get(DEFAULT_CLEANER.id) as { id: string; name: string } | undefined;

  if (!service || !cleaner)
    throw new Error("Booking configuration is incomplete");

  const id = randomUUID();
  const createdAt = new Date().toISOString();

  database.exec("BEGIN IMMEDIATE;");
  try {
    if (!isServiceDayAvailable(input.date)) {
      database.exec("ROLLBACK;");
      return { status: "no-cleaner" as const };
    }

    const existing = database
      .prepare(
        "SELECT id FROM bookings WHERE service_date = ? AND time_slot = ?",
      )
      .get(input.date, input.time);

    if (existing) {
      database.exec("ROLLBACK;");
      return { status: "unavailable" as const };
    }

    database
      .prepare(
        `
        INSERT INTO bookings (
          id, name, email, service_id, service_name, price_cents,
          service_date, time_slot, address, special_instructions, created_at,
          cleaner_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
      `,
      )
      .run(
        id,
        input.name,
        input.email,
        input.serviceId,
        service.name,
        service.priceCents,
        input.date,
        input.time,
        input.address,
        input.specialInstructions ?? null,
        createdAt,
        cleaner.id,
      );

    database.exec("COMMIT;");
    return {
      status: "created" as const,
      booking: {
        ...input,
        specialInstructions: input.specialInstructions ?? null,
        id,
        serviceName: service.name,
        priceCents: service.priceCents,
        createdAt,
        cleanerName: cleaner.name,
      },
    };
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function createRecurringSubscription(
  input: SubscriptionInput,
): RecurringBookingResult {
  const database = getDatabase();
  const service = SERVICES.find((item) => item.id === input.serviceId);
  const cleaner = database
    .prepare("SELECT id, name FROM cleaners WHERE id = ?")
    .get(DEFAULT_CLEANER.id) as { id: string; name: string } | undefined;

  if (!service || !cleaner) {
    throw new Error("Subscription configuration is incomplete");
  }

  const preferredDayName = input.preferredDay
    ? normalizeDayName(input.preferredDay) ??
      getDayNameFromDateString(input.startDate)
    : getDayNameFromDateString(input.startDate);

  const nextServiceDate = getNextServiceDate(
    input.startDate,
    input.preferredDay,
  );

  const dates = generateRecurringDates({
    startDate: input.startDate,
    frequency: input.frequency,
    endDate: input.endDate,
    occurrences: input.occurrences ?? 4,
    preferredDay: input.preferredDay,
  });

  if (dates.length === 0) {
    throw new Error(
      "No appointment dates could be generated for the specified schedule.",
    );
  }

  database.exec("BEGIN IMMEDIATE;");
  try {
    // Edge Case 4: Idempotency safeguard
    if (input.idempotencyKey) {
      const existingSub = database
        .prepare("SELECT * FROM subscriptions WHERE idempotency_key = ?")
        .get(input.idempotencyKey) as StoredSubscription | undefined;

      if (existingSub) {
        const rows = database
          .prepare(
            `SELECT bookings.*, cleaners.name AS cleaner_name
             FROM bookings
             JOIN cleaners ON cleaners.id = bookings.cleaner_id
             WHERE subscription_id = ?
             ORDER BY service_date ASC`,
          )
          .all(existingSub.id) as StoredBooking[];

        database.exec("COMMIT;");
        return {
          status: "created",
          subscription: toSubscription(
            existingSub,
            cleaner.name,
            nextServiceDate,
          ),
          bookings: rows.map(toBooking),
          isDuplicate: true,
        };
      }
    }

    // Edge Case 1: Cleaner unavailable on ANY recurring date.
    // Ensure atomic rollback so no partial/overlapping bookings are saved.
    const servicedDays = getServicedWeekdays();
    for (const date of dates) {
      const conflict = database
        .prepare(
          "SELECT id FROM bookings WHERE service_date = ? AND time_slot = ?",
        )
        .get(date, input.time);

      if (conflict || !servicedDays.has(getDayOfWeekFromDateString(date))) {
        database.exec("ROLLBACK;");
        return {
          status: "conflict",
          conflictDate: date,
          time: input.time,
          error: `Cleaner is unavailable on ${date} at ${input.time}. No bookings were created.`,
        };
      }
    }

    const subscriptionId = randomUUID();
    const createdAt = new Date().toISOString();

    database
      .prepare(
        `INSERT INTO subscriptions (
          id, name, email, address, service_id, service_name, price_cents,
          frequency, preferred_day, start_date, end_date, time_slot, cleaner_id,
          idempotency_key, created_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      )
      .run(
        subscriptionId,
        input.name,
        input.email,
        input.address,
        input.serviceId,
        service.name,
        service.priceCents,
        input.frequency,
        preferredDayName,
        input.startDate,
        input.endDate ?? null,
        input.time,
        cleaner.id,
        input.idempotencyKey ?? null,
        createdAt,
      );

    const createdBookings: Booking[] = [];
    const insertBookingStmt = database.prepare(
      `INSERT INTO bookings (
        id, name, email, service_id, service_name, price_cents,
        service_date, time_slot, address, special_instructions, created_at,
        cleaner_id, status, subscription_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
    );

    for (const date of dates) {
      const bookingId = randomUUID();
      insertBookingStmt.run(
        bookingId,
        input.name,
        input.email,
        input.serviceId,
        service.name,
        service.priceCents,
        date,
        input.time,
        input.address,
        input.specialInstructions ?? null,
        createdAt,
        cleaner.id,
        subscriptionId,
      );

      createdBookings.push({
        id: bookingId,
        name: input.name,
        email: input.email,
        serviceId: input.serviceId,
        serviceName: service.name,
        priceCents: service.priceCents,
        date,
        time: input.time,
        address: input.address,
        specialInstructions: input.specialInstructions ?? null,
        createdAt,
        cleanerName: cleaner.name,
        subscriptionId,
      });
    }

    database.exec("COMMIT;");

    return {
      status: "created",
      subscription: {
        id: subscriptionId,
        name: input.name,
        email: input.email,
        address: input.address,
        serviceId: input.serviceId,
        serviceName: service.name,
        priceCents: service.priceCents,
        frequency: input.frequency,
        preferredDay: preferredDayName,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        time: input.time,
        cleanerName: cleaner.name,
        createdAt,
        status: "active",
        idempotencyKey: input.idempotencyKey ?? null,
        nextServiceDate,
        scheduledCount: createdBookings.length,
      },
      bookings: createdBookings,
    };
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function getSubscription(id: string) {
  const database = getDatabase();
  const subRow = database
    .prepare(
      `SELECT subscriptions.*, cleaners.name AS cleaner_name
       FROM subscriptions
       JOIN cleaners ON cleaners.id = subscriptions.cleaner_id
       WHERE subscriptions.id = ?`,
    )
    .get(id) as StoredSubscription | undefined;

  if (!subRow) return null;

  const bookings = database
    .prepare(
      `SELECT bookings.*, cleaners.name AS cleaner_name
       FROM bookings
       JOIN cleaners ON cleaners.id = bookings.cleaner_id
       WHERE subscription_id = ?
       ORDER BY service_date ASC`,
    )
    .all(id) as StoredBooking[];

  const nextServiceDate =
    bookings.length > 0 ? bookings[0].service_date : subRow.start_date;

  return {
    subscription: toSubscription(subRow, subRow.cleaner_name, nextServiceDate),
    bookings: bookings.map(toBooking),
  };
}

export function getBooking(id: string) {
  const row = getDatabase()
    .prepare(
      `
      SELECT bookings.*, cleaners.name AS cleaner_name
      FROM bookings
      JOIN cleaners ON cleaners.id = bookings.cleaner_id
      WHERE bookings.id = ?
    `,
    )
    .get(id) as StoredBooking | undefined;

  return row ? toBooking(row) : null;
}

export function getBookingRatingDetails(
  id: string,
): BookingRatingDetails | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT
        bookings.id,
        bookings.service_name,
        bookings.service_date,
        bookings.status,
        bookings.email,
        bookings.accepted_by_id,
        bookings.accepted_by_name,
        cleaners.id AS cleaner_id,
        cleaners.name AS cleaner_name,
        ratings.stars AS rating,
        ratings.review AS review
      FROM bookings
      JOIN cleaners ON cleaners.id = bookings.cleaner_id
      LEFT JOIN ratings ON ratings.booking_id = bookings.id
      WHERE bookings.id = ?
    `,
    )
    .get(id) as
    | {
        id: string;
        service_name: string;
        service_date: string;
        status: "scheduled" | "completed";
        email: string;
        accepted_by_id: string | null;
        accepted_by_name: string | null;
        cleaner_id: string;
        cleaner_name: string;
        rating: number | null;
        review: string | null;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    serviceName: row.service_name,
    date: row.service_date,
    status: row.status,
    cleanerId: row.cleaner_id,
    cleanerName: row.accepted_by_name || row.cleaner_name,
    customerEmail: row.email.toLowerCase(),
    isAccepted: Boolean(row.accepted_by_id),
    rating: row.rating,
    review: row.review ?? null,
  };
}

export function markBookingCompleted(id: string, cleanerId: string) {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE;");
  try {
    const booking = database
      .prepare("SELECT id FROM bookings WHERE id = ?")
      .get(id);
    if (!booking) {
      database.exec("ROLLBACK;");
      return { status: "not-found" as const };
    }

    const cleaner = database
      .prepare("SELECT id FROM cleaners WHERE id = ?")
      .get(cleanerId);
    if (!cleaner) {
      database.exec("ROLLBACK;");
      return { status: "unknown-cleaner" as const };
    }

    database
      .prepare(
        "UPDATE bookings SET status = 'completed', cleaner_id = ? WHERE id = ?",
      )
      .run(cleanerId, id);
    database.exec("COMMIT;");
    return { status: "completed" as const };
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function submitBookingRating(
  id: string,
  stars: number,
  review: string | null = null,
) {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE;");
  try {
    const booking = database
      .prepare("SELECT status, cleaner_id FROM bookings WHERE id = ?")
      .get(id) as
      | { status: "scheduled" | "completed"; cleaner_id: string }
      | undefined;

    if (!booking) {
      database.exec("ROLLBACK;");
      return { status: "not-found" as const };
    }
    if (booking.status !== "completed") {
      database.exec("ROLLBACK;");
      return { status: "not-completed" as const };
    }

    const existingRating = database
      .prepare("SELECT stars FROM ratings WHERE booking_id = ?")
      .get(id) as { stars: number } | undefined;
    if (existingRating) {
      database.exec("ROLLBACK;");
      return { status: "already-rated" as const, stars: existingRating.stars };
    }

    database
      .prepare(
        "INSERT INTO ratings (id, booking_id, cleaner_id, stars, review, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        id,
        booking.cleaner_id,
        stars,
        review?.trim() || null,
        new Date().toISOString(),
      );
    database.exec("COMMIT;");
    return { status: "rated" as const, stars, review: review?.trim() || null };
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function getCustomerBookings(customerEmail: string) {
  const database = getDatabase();
  const normalizedEmail = customerEmail.trim().toLowerCase();

  const rows = database
    .prepare(
      `
      SELECT
        bookings.id,
        bookings.name,
        bookings.email,
        bookings.service_id,
        bookings.service_name,
        bookings.price_cents,
        bookings.service_date,
        bookings.time_slot,
        bookings.address,
        bookings.special_instructions,
        bookings.created_at,
        bookings.cleaner_id,
        cleaners.name AS cleaner_name,
        bookings.status,
        bookings.subscription_id,
        bookings.accepted_by_id,
        bookings.accepted_by_name,
        bookings.accepted_at,
        ratings.stars AS rating,
        ratings.review AS review
      FROM bookings
      JOIN cleaners ON cleaners.id = bookings.cleaner_id
      LEFT JOIN ratings ON ratings.booking_id = bookings.id
      WHERE LOWER(bookings.email) = ?
      ORDER BY bookings.service_date ASC, bookings.time_slot ASC
    `,
    )
    .all(normalizedEmail) as Array<{
      id: string;
      name: string;
      email: string;
      service_id: ServiceId;
      service_name: string;
      price_cents: number;
      service_date: string;
      time_slot: BookingTime;
      address: string;
      special_instructions: string | null;
      created_at: string;
      cleaner_id: string;
      cleaner_name: string;
      status: "scheduled" | "completed";
      subscription_id: string | null;
      accepted_by_id: string | null;
      accepted_by_name: string | null;
      accepted_at: string | null;
      rating: number | null;
      review: string | null;
    }>;

  const today = localDateString();

  const all: CustomerBooking[] = rows.map((row) => {
    const isUpcoming = row.status === "scheduled" && row.service_date >= today;
    const statusLabel = row.status === "completed" ? "Completed" : "Scheduled";
    const isAccepted = Boolean(row.accepted_by_id || row.accepted_by_name);

    return {
      id: row.id,
      name: row.name,
      email: row.email,
      serviceId: row.service_id,
      serviceName: row.service_name,
      priceCents: row.price_cents,
      date: row.service_date,
      time: row.time_slot,
      address: row.address,
      specialInstructions: row.special_instructions ?? null,
      createdAt: row.created_at,
      cleanerId: row.cleaner_id,
      cleanerName: row.accepted_by_name || row.cleaner_name,
      acceptedById: row.accepted_by_id ?? null,
      acceptedByName: row.accepted_by_name ?? null,
      acceptedAt: row.accepted_at ?? null,
      isAccepted,
      status: row.status,
      statusLabel,
      subscriptionId: row.subscription_id ?? null,
      rating: row.rating ?? null,
      review: row.review ?? null,
      isUpcoming,
      canCancel:
        row.status === "scheduled" &&
        !row.subscription_id &&
        isWithinCancellationWindow(row.service_date, row.time_slot),
    };
  });

  const upcoming = all.filter((b) => b.isUpcoming);
  // Sort previous descending (latest date first)
  const previous = all
    .filter((b) => !b.isUpcoming)
    .sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return b.time.localeCompare(a.time);
    });

  return {
    customerEmail: normalizedEmail,
    bookings: all,
    upcoming,
    previous,
    cancelled: getCancelledBookings(normalizedEmail),
  };
}

type CancelledBookingRow = {
  id: string;
  service_name: string;
  price_cents: number;
  service_date: string;
  time_slot: BookingTime;
  address: string;
  cancelled_at: string;
};

function toCancelledBooking(row: CancelledBookingRow): CancelledBooking {
  return {
    id: row.id,
    serviceName: row.service_name,
    priceCents: row.price_cents,
    date: row.service_date,
    time: row.time_slot,
    address: row.address,
    cancelledAt: row.cancelled_at,
  };
}

/** US-05: the customer's cancelled bookings, most recently cancelled first. */
export function getCancelledBookings(customerEmail: string): CancelledBooking[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, service_name, price_cents, service_date, time_slot, address, cancelled_at
       FROM cancelled_bookings
       WHERE LOWER(email) = ?
       ORDER BY cancelled_at DESC`,
    )
    .all(customerEmail.trim().toLowerCase()) as CancelledBookingRow[];
  return rows.map(toCancelledBooking);
}

/** US-06: an upcoming job the cleaner had accepted that the customer cancelled. */
export type CleanerCancelledJob = CancelledBooking & {
  customerName: string;
  status: "cancelled";
  statusLabel: string;
};

/**
 * US-06: upcoming jobs this cleaner had accepted that the customer then
 * cancelled (US-05 moves them out of `bookings`), soonest first, so the
 * cleaner can see the job is off instead of it silently disappearing.
 */
export function getCleanerCancelledJobs(cleanerId: string): CleanerCancelledJob[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, service_name, price_cents, service_date, time_slot, address, cancelled_at
       FROM cancelled_bookings
       WHERE accepted_by_id = ? AND service_date >= ?
       ORDER BY service_date ASC, time_slot ASC`,
    )
    .all(cleanerId, localDateString()) as Array<CancelledBookingRow & { name: string }>;
  return rows.map((row) => ({
    ...toCancelledBooking(row),
    customerName: row.name,
    status: "cancelled" as const,
    statusLabel: "Cancelled by customer",
  }));
}

/**
 * US-05: cancels one of the customer's own one-time bookings.
 * - Allowed only while the visit is at least 24 hours away (Bangkok time).
 * - Completed bookings and recurring-plan visits (use Skip) can't be cancelled.
 * - Someone else's booking is reported as not found, so ids can't be probed.
 * - Cancelling again (e.g. a retry) returns "already-cancelled", not an error.
 * The booking is moved to `cancelled_bookings` in one transaction, which frees
 * its arrival window for other customers and removes it from the cleaner's jobs.
 */
export function cancelCustomerBooking(
  bookingId: string,
  customerEmail: string,
  nowOverride?: Date,
): CancelBookingResult {
  const email = customerEmail.trim().toLowerCase();
  return withTransaction(() => {
    // Read the clock after BEGIN IMMEDIATE has the lock, so waiting for
    // another writer can never let a cancellation slip past the cutoff.
    const now = nowOverride ?? new Date();
    const database = getDatabase();
    const booking = database
      .prepare(
        `SELECT id, name, email, service_id, service_name, price_cents, service_date,
                time_slot, address, special_instructions, accepted_by_id,
                accepted_by_name, created_at, status, subscription_id
         FROM bookings WHERE id = ? AND LOWER(email) = ?`,
      )
      .get(bookingId, email) as
      | {
          id: string;
          name: string;
          email: string;
          service_id: string;
          service_name: string;
          price_cents: number;
          service_date: string;
          time_slot: BookingTime;
          address: string;
          special_instructions: string | null;
          accepted_by_id: string | null;
          accepted_by_name: string | null;
          created_at: string;
          status: "scheduled" | "completed";
          subscription_id: string | null;
        }
      | undefined;

    if (!booking) {
      // A retry after a lost response: report the earlier cancellation again.
      const earlier = database
        .prepare(
          `SELECT id, service_name, price_cents, service_date, time_slot, address, cancelled_at
           FROM cancelled_bookings WHERE id = ? AND LOWER(email) = ?`,
        )
        .get(bookingId, email) as CancelledBookingRow | undefined;
      if (earlier) {
        return {
          status: "already-cancelled" as const,
          booking: toCancelledBooking(earlier),
          message: `This booking was already cancelled. You won't be charged.`,
        };
      }
      return { status: "not-found" as const };
    }
    if (booking.status === "completed") return { status: "completed" as const };
    if (booking.subscription_id) return { status: "recurring" as const };
    if (!isWithinCancellationWindow(booking.service_date, booking.time_slot, now)) {
      return { status: "too-late" as const };
    }

    const cancelledAt = now.toISOString();
    database
      .prepare(
        `INSERT INTO cancelled_bookings (
           id, name, email, service_id, service_name, price_cents, service_date,
           time_slot, address, special_instructions, accepted_by_id,
           accepted_by_name, created_at, cancelled_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        booking.id,
        booking.name,
        booking.email,
        booking.service_id,
        booking.service_name,
        booking.price_cents,
        booking.service_date,
        booking.time_slot,
        booking.address,
        booking.special_instructions,
        booking.accepted_by_id,
        booking.accepted_by_name,
        booking.created_at,
        cancelledAt,
      );
    database.prepare("DELETE FROM bookings WHERE id = ?").run(booking.id);

    const cancelled = toCancelledBooking({ ...booking, cancelled_at: cancelledAt });
    return {
      status: "cancelled" as const,
      booking: cancelled,
      message: `Your ${booking.service_name} on ${displayDayAndDate(booking.service_date)} at ${displaySlotTime(booking.time_slot)} has been cancelled. You won't be charged.`,
    };
  });
}

export function createCustomerSession(email: string, durationDays = 7): string {
  const token = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  getDatabase()
    .prepare(
      "INSERT INTO customer_sessions (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(token, email.trim().toLowerCase(), now.toISOString(), expires.toISOString());
  return token;
}

export function getCustomerFromSessionToken(token: string): string | null {
  if (!token || typeof token !== "string") return null;
  const now = new Date().toISOString();
  const row = getDatabase()
    .prepare(
      "SELECT email FROM customer_sessions WHERE token = ? AND expires_at > ?",
    )
    .get(token, now) as { email: string } | undefined;
  return row ? row.email.toLowerCase() : null;
}

export function deleteCustomerSession(token: string): void {
  deleteSession(token);
}

export type UserRole = "customer" | "cleaner" | "admin";
export type UserStatus = "active" | "suspended";

export type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  cleanerId: string | null;
  status: UserStatus;
  createdAt: string;
};

export type StoredUser = User & {
  password_hash: string;
};

export type Session = {
  token: string;
  userId: string;
  email: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
};

export function createUser(input: {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  cleanerId?: string | null;
  status?: UserStatus;
}): User {
  const database = getDatabase();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const normalizedEmail = input.email.trim().toLowerCase();
  const status = input.status ?? "active";
  const cleanerId = input.cleanerId ?? null;

  database
    .prepare(
      `INSERT INTO users (id, email, password_hash, name, role, cleaner_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      normalizedEmail,
      input.passwordHash,
      input.name.trim(),
      input.role,
      cleanerId,
      status,
      createdAt
    );

  return {
    id,
    email: normalizedEmail,
    name: input.name.trim(),
    role: input.role,
    cleanerId,
    status,
    createdAt,
  };
}

export type RegisterAccountResult =
  | { status: "created"; user: User }
  | { status: "email-taken" };

/**
 * Self-registration for customers and cleaners. A cleaner also gets their own
 * `cleaners` row (working Monday–Friday until they change it). Admin accounts
 * are never created here: there is exactly one seeded admin.
 */
export function registerAccount(input: {
  email: string;
  passwordHash: string;
  name: string;
  role: "customer" | "cleaner";
}): RegisterAccountResult {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    if (getUserByEmail(input.email)) {
      database.exec("ROLLBACK");
      return { status: "email-taken" };
    }

    let cleanerId: string | null = null;
    if (input.role === "cleaner") {
      cleanerId = `cleaner-${randomUUID()}`;
      database
        .prepare("INSERT INTO cleaners (id, name, available_days) VALUES (?, ?, ?)")
        .run(cleanerId, input.name.trim(), "1,2,3,4,5");
    }

    const user = createUser({
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      role: input.role,
      cleanerId,
    });
    database.exec("COMMIT");
    return { status: "created", user };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getUserByEmail(email: string): StoredUser | null {
  if (!email || typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  const row = getDatabase()
    .prepare("SELECT * FROM users WHERE LOWER(email) = ?")
    .get(normalized) as
    | {
        id: string;
        email: string;
        password_hash: string;
        name: string;
        role: UserRole;
        cleaner_id: string | null;
        status: UserStatus;
        created_at: string;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash,
    name: row.name,
    role: row.role,
    cleanerId: row.cleaner_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function getUserById(id: string): User | null {
  if (!id || typeof id !== "string") return null;
  const row = getDatabase()
    .prepare("SELECT id, email, name, role, cleaner_id, status, created_at FROM users WHERE id = ?")
    .get(id) as
    | {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        cleaner_id: string | null;
        status: UserStatus;
        created_at: string;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    cleanerId: row.cleaner_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function updateUserStatus(userId: string, status: UserStatus): boolean {
  const result = getDatabase()
    .prepare("UPDATE users SET status = ? WHERE id = ?")
    .run(status, userId);
  return result.changes > 0;
}

export function listUsers(): User[] {
  const rows = getDatabase()
    .prepare("SELECT id, email, name, role, cleaner_id, status, created_at FROM users ORDER BY created_at DESC")
    .all() as Array<{
      id: string;
      email: string;
      name: string;
      role: UserRole;
      cleaner_id: string | null;
      status: UserStatus;
      created_at: string;
    }>;

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    cleanerId: r.cleaner_id,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export function createUserSession(userId: string, durationDays = 7): Session {
  const database = getDatabase();
  const user = getUserById(userId);
  if (!user) throw new Error("User not found");

  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 86400000).toISOString();
  const createdAt = now.toISOString();

  database
    .prepare(
      "INSERT INTO sessions (token, user_id, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(token, user.id, user.email, user.role, createdAt, expiresAt);

  if (user.role === "customer") {
    database
      .prepare(
        "INSERT OR REPLACE INTO customer_sessions (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)"
      )
      .run(token, user.email, createdAt, expiresAt);
  }

  return {
    token,
    userId: user.id,
    email: user.email,
    role: user.role,
    createdAt,
    expiresAt,
  };
}

export function getSession(token: string): Session | null {
  if (!token || typeof token !== "string") return null;
  const now = new Date().toISOString();
  const database = getDatabase();

  const sessionRow = database
    .prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, now) as
    | {
        token: string;
        user_id: string;
        email: string;
        role: UserRole;
        created_at: string;
        expires_at: string;
      }
    | undefined;

  if (sessionRow) {
    return {
      token: sessionRow.token,
      userId: sessionRow.user_id,
      email: sessionRow.email,
      role: sessionRow.role,
      createdAt: sessionRow.created_at,
      expiresAt: sessionRow.expires_at,
    };
  }

  const custRow = database
    .prepare("SELECT * FROM customer_sessions WHERE token = ? AND expires_at > ?")
    .get(token, now) as
    | {
        token: string;
        email: string;
        created_at: string;
        expires_at: string;
      }
    | undefined;

  if (custRow) {
    const user = getUserByEmail(custRow.email);
    return {
      token: custRow.token,
      userId: user ? user.id : "legacy-customer",
      email: custRow.email,
      role: user ? user.role : "customer",
      createdAt: custRow.created_at,
      expiresAt: custRow.expires_at,
    };
  }

  return null;
}

export function deleteSession(token: string): void {
  if (!token || typeof token !== "string") return;
  const database = getDatabase();
  database.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  database.prepare("DELETE FROM customer_sessions WHERE token = ?").run(token);
}

export function getCleanerBookings(cleanerId: string): CustomerBooking[] {
  const database = getDatabase();
  const rows = database
    .prepare(
      `SELECT
        bookings.id,
        bookings.name,
        bookings.email,
        bookings.service_id,
        bookings.service_name,
        bookings.price_cents,
        bookings.service_date,
        bookings.time_slot,
        bookings.address,
        bookings.special_instructions,
        bookings.created_at,
        bookings.cleaner_id,
        cleaners.name AS cleaner_name,
        bookings.status,
        bookings.subscription_id,
        bookings.accepted_by_id,
        bookings.accepted_by_name,
        bookings.accepted_at,
        ratings.stars AS rating,
        ratings.review AS review
      FROM bookings
      JOIN cleaners ON cleaners.id = bookings.cleaner_id
      LEFT JOIN ratings ON ratings.booking_id = bookings.id
      WHERE bookings.accepted_by_id = ?
      ORDER BY bookings.service_date ASC, bookings.time_slot ASC`
    )
    .all(cleanerId) as Array<{
      id: string;
      name: string;
      email: string;
      service_id: ServiceId;
      service_name: string;
      price_cents: number;
      service_date: string;
      time_slot: BookingTime;
      address: string;
      special_instructions: string | null;
      created_at: string;
      cleaner_id: string;
      cleaner_name: string;
      status: "scheduled" | "completed";
      subscription_id: string | null;
      accepted_by_id: string | null;
      accepted_by_name: string | null;
      accepted_at: string | null;
      rating: number | null;
      review: string | null;
    }>;

  const today = localDateString();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    serviceId: row.service_id,
    serviceName: row.service_name,
    priceCents: row.price_cents,
    date: row.service_date,
    time: row.time_slot,
    address: row.address,
    specialInstructions: row.special_instructions ?? null,
    createdAt: row.created_at,
    cleanerId: row.cleaner_id,
    cleanerName: row.accepted_by_name || row.cleaner_name,
    acceptedById: row.accepted_by_id ?? null,
    acceptedByName: row.accepted_by_name ?? null,
    acceptedAt: row.accepted_at ?? null,
    isAccepted: Boolean(row.accepted_by_id || row.accepted_by_name),
    status: row.status,
    statusLabel: row.status === "completed" ? "Completed" : "Scheduled",
    subscriptionId: row.subscription_id ?? null,
    rating: row.rating ?? null,
    review: row.review ?? null,
    isUpcoming: row.status === "scheduled" && row.service_date >= today,
  }));
}

export function getAvailableBookingRequests(): CustomerBooking[] {
  const database = getDatabase();
  const rows = database
    .prepare(
      `SELECT
        bookings.id,
        bookings.name,
        bookings.email,
        bookings.service_id,
        bookings.service_name,
        bookings.price_cents,
        bookings.service_date,
        bookings.time_slot,
        bookings.address,
        bookings.special_instructions,
        bookings.created_at,
        bookings.cleaner_id,
        cleaners.name AS cleaner_name,
        bookings.status,
        bookings.subscription_id,
        bookings.accepted_by_id,
        bookings.accepted_by_name,
        bookings.accepted_at,
        ratings.stars AS rating,
        ratings.review AS review
      FROM bookings
      JOIN cleaners ON cleaners.id = bookings.cleaner_id
      LEFT JOIN ratings ON ratings.booking_id = bookings.id
      WHERE bookings.status = 'scheduled'
        AND (bookings.accepted_by_id IS NULL OR bookings.accepted_by_id = '')
        AND bookings.service_date >= ?
      ORDER BY bookings.service_date ASC, bookings.time_slot ASC`
    )
    .all(localDateString()) as Array<{
      id: string;
      name: string;
      email: string;
      service_id: ServiceId;
      service_name: string;
      price_cents: number;
      service_date: string;
      time_slot: BookingTime;
      address: string;
      special_instructions: string | null;
      created_at: string;
      cleaner_id: string;
      cleaner_name: string;
      status: "scheduled" | "completed";
      subscription_id: string | null;
      accepted_by_id: string | null;
      accepted_by_name: string | null;
      accepted_at: string | null;
      rating: number | null;
      review: string | null;
    }>;

  const today = localDateString();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    serviceId: row.service_id,
    serviceName: row.service_name,
    priceCents: row.price_cents,
    date: row.service_date,
    time: row.time_slot,
    address: row.address,
    specialInstructions: row.special_instructions ?? null,
    createdAt: row.created_at,
    cleanerId: row.cleaner_id,
    cleanerName: row.accepted_by_name || row.cleaner_name,
    acceptedById: row.accepted_by_id ?? null,
    acceptedByName: row.accepted_by_name ?? null,
    acceptedAt: row.accepted_at ?? null,
    isAccepted: false,
    status: row.status,
    statusLabel: "Pending Cleaner Acceptance",
    subscriptionId: row.subscription_id ?? null,
    rating: row.rating ?? null,
    review: row.review ?? null,
    isUpcoming: row.service_date >= today,
  }));
}

export function acceptBookingRequest(
  bookingId: string,
  cleanerId: string,
  cleanerName: string,
): { success: boolean; error?: string } {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE;");
  try {
    const existing = database
      .prepare(
        "SELECT id, status, service_date, accepted_by_id FROM bookings WHERE id = ?",
      )
      .get(bookingId) as
      | {
          id: string;
          status: string;
          service_date: string;
          accepted_by_id: string | null;
        }
      | undefined;

    if (!existing) {
      database.exec("ROLLBACK;");
      return { success: false, error: "Booking request not found." };
    }

    if (existing.status === "completed") {
      database.exec("ROLLBACK;");
      return { success: false, error: "Cannot accept a completed booking." };
    }

    if (existing.accepted_by_id) {
      database.exec("ROLLBACK;");
      return {
        success: false,
        error:
          existing.accepted_by_id === cleanerId
            ? "You have already accepted this booking."
            : "Another cleaner has already accepted this booking.",
      };
    }

    // Ensure cleaner exists in cleaners table
    database
      .prepare("INSERT OR IGNORE INTO cleaners (id, name) VALUES (?, ?)")
      .run(cleanerId, cleanerName);

    const weekday = getDayOfWeekFromDateString(existing.service_date);
    if (!getCleanerAvailableDays(cleanerId).includes(weekday)) {
      database.exec("ROLLBACK;");
      return {
        success: false,
        error: `You are not available on ${getDayNameFromDateString(existing.service_date)}s. Update your availability to accept this job.`,
      };
    }

    database
      .prepare(
        `UPDATE bookings
         SET cleaner_id = ?,
             accepted_by_id = ?,
             accepted_by_name = ?,
             accepted_at = ?
         WHERE id = ?`,
      )
      .run(cleanerId, cleanerId, cleanerName, new Date().toISOString(), bookingId);

    database.exec("COMMIT;");
    return { success: true };
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function getBookingAssignment(
  bookingId: string,
): { status: "scheduled" | "completed"; acceptedById: string | null } | null {
  const row = getDatabase()
    .prepare("SELECT status, accepted_by_id FROM bookings WHERE id = ?")
    .get(bookingId) as
    | { status: "scheduled" | "completed"; accepted_by_id: string | null }
    | undefined;
  return row
    ? { status: row.status, acceptedById: row.accepted_by_id ?? null }
    : null;
}

/** US-17A: every booking for the admin Bookings tab, sorted by date, then time slot. */
export function getAllBookingsAdmin(): Array<CustomerBooking & { customerName: string }> {
  const database = getDatabase();
  const rows = database
    .prepare(
      `SELECT
        bookings.id,
        bookings.name,
        bookings.email,
        bookings.service_id,
        bookings.service_name,
        bookings.price_cents,
        bookings.service_date,
        bookings.time_slot,
        bookings.address,
        bookings.special_instructions,
        bookings.created_at,
        bookings.cleaner_id,
        cleaners.name AS cleaner_name,
        bookings.status,
        bookings.subscription_id,
        bookings.accepted_by_id,
        bookings.accepted_by_name,
        bookings.accepted_at,
        ratings.stars AS rating,
        ratings.review AS review
      FROM bookings
      JOIN cleaners ON cleaners.id = bookings.cleaner_id
      LEFT JOIN ratings ON ratings.booking_id = bookings.id
      ORDER BY bookings.service_date ASC, bookings.time_slot ASC`
    )
    .all() as Array<{
      id: string;
      name: string;
      email: string;
      service_id: ServiceId;
      service_name: string;
      price_cents: number;
      service_date: string;
      time_slot: BookingTime;
      address: string;
      special_instructions: string | null;
      created_at: string;
      cleaner_id: string;
      cleaner_name: string;
      status: "scheduled" | "completed";
      subscription_id: string | null;
      accepted_by_id: string | null;
      accepted_by_name: string | null;
      accepted_at: string | null;
      rating: number | null;
      review: string | null;
    }>;

  const today = localDateString();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    customerName: row.name,
    email: row.email,
    serviceId: row.service_id,
    serviceName: row.service_name,
    priceCents: row.price_cents,
    date: row.service_date,
    time: row.time_slot,
    address: row.address,
    specialInstructions: row.special_instructions ?? null,
    createdAt: row.created_at,
    cleanerId: row.cleaner_id,
    cleanerName: row.accepted_by_name || row.cleaner_name,
    acceptedById: row.accepted_by_id ?? null,
    acceptedByName: row.accepted_by_name ?? null,
    acceptedAt: row.accepted_at ?? null,
    isAccepted: Boolean(row.accepted_by_id || row.accepted_by_name),
    status: row.status,
    statusLabel: row.status === "completed" ? "Completed" : "Scheduled",
    subscriptionId: row.subscription_id ?? null,
    rating: row.rating ?? null,
    review: row.review ?? null,
    isUpcoming: row.status === "scheduled" && row.service_date >= today,
  }));
}

export function getPlatformStats(): {
  totalBookings: number;
  scheduledBookings: number;
  completedBookings: number;
  totalUsers: number;
  totalRevenueCents: number;
} {
  const database = getDatabase();
  const bookingStats = database
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        COALESCE(SUM(price_cents), 0) as totalRevenue
       FROM bookings`
    )
    .get() as { total: number; scheduled: number; completed: number; totalRevenue: number };

  const userStats = database
    .prepare("SELECT COUNT(*) as totalUsers FROM users")
    .get() as { totalUsers: number };

  return {
    totalBookings: bookingStats?.total ?? 0,
    scheduledBookings: bookingStats?.scheduled ?? 0,
    completedBookings: bookingStats?.completed ?? 0,
    totalUsers: userStats?.totalUsers ?? 0,
    totalRevenueCents: bookingStats?.totalRevenue ?? 0,
  };
}


export type AdminCleanerSummary = {
  userId: string;
  cleanerId: string;
  name: string;
  email: string;
  status: UserStatus;
  availableDays: number[];
  upcomingJobs: number;
  completedJobs: number;
  earningsCents: number;
  averageRating: number | null;
  reviewCount: number;
};

export type AdminCustomerSummary = {
  userId: string | null;
  name: string;
  email: string;
  status: UserStatus | "guest";
  totalBookings: number;
  upcomingBookings: number;
  completedBookings: number;
  totalSpentCents: number;
  lastServiceDate: string | null;
  reviewsWritten: number;
};

export type AdminReview = {
  bookingId: string;
  serviceName: string;
  serviceDate: string;
  customerName: string;
  customerEmail: string;
  cleanerId: string;
  cleanerName: string;
  stars: number;
  review: string | null;
  createdAt: string;
};

export function getAdminCleanerSummaries(): AdminCleanerSummary[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
        users.id AS user_id,
        users.name,
        users.email,
        users.status,
        cleaners.id AS cleaner_id,
        cleaners.available_days,
        (SELECT COUNT(*) FROM bookings b
          WHERE b.accepted_by_id = cleaners.id AND b.status = 'scheduled') AS upcoming_jobs,
        (SELECT COUNT(*) FROM bookings b
          WHERE b.accepted_by_id = cleaners.id AND b.status = 'completed') AS completed_jobs,
        (SELECT COALESCE(SUM(b.price_cents), 0) FROM bookings b
          WHERE b.accepted_by_id = cleaners.id AND b.status = 'completed') AS earnings_cents,
        (SELECT AVG(r.stars) FROM ratings r WHERE r.cleaner_id = cleaners.id) AS average_rating,
        (SELECT COUNT(*) FROM ratings r WHERE r.cleaner_id = cleaners.id) AS review_count
      FROM users
      JOIN cleaners ON cleaners.id = users.cleaner_id
      WHERE users.role = 'cleaner'
      ORDER BY users.name ASC`,
    )
    .all() as Array<{
    user_id: string;
    name: string;
    email: string;
    status: UserStatus;
    cleaner_id: string;
    available_days: string;
    upcoming_jobs: number;
    completed_jobs: number;
    earnings_cents: number;
    average_rating: number | null;
    review_count: number;
  }>;

  return rows.map((row) => ({
    userId: row.user_id,
    cleanerId: row.cleaner_id,
    name: row.name,
    email: row.email,
    status: row.status,
    availableDays: parseWeekdays(row.available_days),
    upcomingJobs: row.upcoming_jobs,
    completedJobs: row.completed_jobs,
    earningsCents: row.earnings_cents,
    averageRating:
      row.average_rating === null
        ? null
        : Math.round(row.average_rating * 10) / 10,
    reviewCount: row.review_count,
  }));
}

export function getAdminCustomerSummaries(): AdminCustomerSummary[] {
  const database = getDatabase();
  const bookingRows = database
    .prepare(
      `SELECT
        LOWER(bookings.email) AS email,
        MAX(bookings.name) AS name,
        COUNT(*) AS total_bookings,
        SUM(CASE WHEN bookings.status = 'scheduled' THEN 1 ELSE 0 END) AS upcoming_bookings,
        SUM(CASE WHEN bookings.status = 'completed' THEN 1 ELSE 0 END) AS completed_bookings,
        COALESCE(SUM(bookings.price_cents), 0) AS total_spent_cents,
        MAX(bookings.service_date) AS last_service_date,
        COUNT(ratings.id) AS reviews_written
      FROM bookings
      LEFT JOIN ratings ON ratings.booking_id = bookings.id
      GROUP BY LOWER(bookings.email)`,
    )
    .all() as Array<{
    email: string;
    name: string;
    total_bookings: number;
    upcoming_bookings: number;
    completed_bookings: number;
    total_spent_cents: number;
    last_service_date: string | null;
    reviews_written: number;
  }>;

  const customerUsers = listUsers().filter((user) => user.role === "customer");
  const byEmail = new Map(bookingRows.map((row) => [row.email, row]));
  const summaries: AdminCustomerSummary[] = customerUsers.map((user) => {
    const row = byEmail.get(user.email.toLowerCase());
    byEmail.delete(user.email.toLowerCase());
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      totalBookings: row?.total_bookings ?? 0,
      upcomingBookings: row?.upcoming_bookings ?? 0,
      completedBookings: row?.completed_bookings ?? 0,
      totalSpentCents: row?.total_spent_cents ?? 0,
      lastServiceDate: row?.last_service_date ?? null,
      reviewsWritten: row?.reviews_written ?? 0,
    };
  });

  // Bookings placed without an account (e.g. before sign-in existed)
  for (const row of byEmail.values()) {
    summaries.push({
      userId: null,
      name: row.name,
      email: row.email,
      status: "guest",
      totalBookings: row.total_bookings,
      upcomingBookings: row.upcoming_bookings,
      completedBookings: row.completed_bookings,
      totalSpentCents: row.total_spent_cents,
      lastServiceDate: row.last_service_date,
      reviewsWritten: row.reviews_written,
    });
  }

  return summaries.sort((a, b) => b.totalBookings - a.totalBookings);
}

export function listReviews(): AdminReview[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
        bookings.id AS booking_id,
        bookings.service_name,
        bookings.service_date,
        bookings.name AS customer_name,
        bookings.email AS customer_email,
        ratings.cleaner_id,
        COALESCE(bookings.accepted_by_name, cleaners.name) AS cleaner_name,
        ratings.stars,
        ratings.review,
        ratings.created_at
      FROM ratings
      JOIN bookings ON bookings.id = ratings.booking_id
      JOIN cleaners ON cleaners.id = ratings.cleaner_id
      ORDER BY ratings.created_at DESC`,
    )
    .all() as Array<{
    booking_id: string;
    service_name: string;
    service_date: string;
    customer_name: string;
    customer_email: string;
    cleaner_id: string;
    cleaner_name: string;
    stars: number;
    review: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    bookingId: row.booking_id,
    serviceName: row.service_name,
    serviceDate: row.service_date,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    cleanerId: row.cleaner_id,
    cleanerName: row.cleaner_name,
    stars: row.stars,
    review: row.review,
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// US-15: pause and skip recurring cleanings
// ---------------------------------------------------------------------------

/** Longest pause a customer can set, in days from today. */
export const MAX_PAUSE_DAYS = 365;

export type SubscriptionPlanStatus = "active" | "paused" | "cancelled";

export type CustomerSubscription = {
  id: string;
  serviceName: string;
  frequency: Frequency;
  preferredDay: string;
  time: BookingTime;
  priceCents: number;
  address: string;
  status: SubscriptionPlanStatus;
  pausedUntil: string | null;
  /** The next visit that can still be skipped (after today, not completed). */
  nextVisit: { bookingId: string; date: string; isAccepted: boolean } | null;
  upcomingVisits: string[];
  lastVisitDate: string | null;
  skippedVisits: Array<{ date: string; reason: "skip" | "pause" }>;
};

type SubscriptionRowWithPause = StoredSubscription & {
  paused_until: string | null;
};

type SubscriptionVisitRow = {
  id: string;
  service_date: string;
  status: "scheduled" | "completed";
  accepted_by_id: string | null;
};

function planStatus(row: SubscriptionRowWithPause, today: string): SubscriptionPlanStatus {
  if (row.status === "cancelled") return "cancelled";
  if (row.paused_until && row.paused_until > today) return "paused";
  return "active";
}

function findOwnedSubscription(id: string, customerEmail: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(id) as SubscriptionRowWithPause | undefined;
  // Someone else's plan is reported as "not found" so ids can't be probed.
  if (!row || row.email.toLowerCase() !== customerEmail.trim().toLowerCase()) {
    return null;
  }
  return row;
}

function toCustomerSubscription(
  row: SubscriptionRowWithPause,
  today: string,
): CustomerSubscription {
  const database = getDatabase();
  const visits = database
    .prepare(
      `SELECT id, service_date, status, accepted_by_id FROM bookings
       WHERE subscription_id = ? ORDER BY service_date ASC`,
    )
    .all(row.id) as SubscriptionVisitRow[];
  const skips = database
    .prepare(
      `SELECT service_date, reason FROM subscription_skips
       WHERE subscription_id = ? AND service_date > ? ORDER BY service_date ASC`,
    )
    .all(row.id, today) as Array<{ service_date: string; reason: "skip" | "pause" }>;

  const upcoming = visits.filter(
    (visit) => visit.status === "scheduled" && visit.service_date > today,
  );
  const next = upcoming[0];

  return {
    id: row.id,
    serviceName: row.service_name,
    frequency: row.frequency,
    preferredDay: row.preferred_day,
    time: row.time_slot,
    priceCents: row.price_cents,
    address: row.address,
    status: planStatus(row, today),
    pausedUntil: row.paused_until && row.paused_until > today ? row.paused_until : null,
    nextVisit: next
      ? { bookingId: next.id, date: next.service_date, isAccepted: Boolean(next.accepted_by_id) }
      : null,
    upcomingVisits: upcoming.map((visit) => visit.service_date),
    lastVisitDate: visits.length ? visits[visits.length - 1].service_date : null,
    skippedVisits: skips.map((skip) => ({ date: skip.service_date, reason: skip.reason })),
  };
}

/** A customer's recurring plans, newest first. */
export function listCustomerSubscriptions(customerEmail: string): CustomerSubscription[] {
  const today = localDateString();
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM subscriptions WHERE LOWER(email) = ? ORDER BY created_at DESC`,
    )
    .all(customerEmail.trim().toLowerCase()) as SubscriptionRowWithPause[];
  return rows.map((row) => toCustomerSubscription(row, today));
}

export type SubscriptionChangeResult =
  | { status: "ok"; subscription: CustomerSubscription; message: string; dates: string[] }
  | { status: "not-found" | "invalid" | "conflict"; error: string }
  // A cleaner has already accepted some of the visits that would be removed;
  // the customer must confirm before the cleaner loses those jobs.
  | { status: "needs-confirmation"; error: string; dates: string[] };

function withTransaction<T>(work: () => T): T {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = work();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function recordSkip(
  subscriptionId: string,
  date: string,
  time: BookingTime,
  reason: "skip" | "pause",
) {
  getDatabase()
    .prepare(
      `INSERT INTO subscription_skips (id, subscription_id, service_date, time_slot, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), subscriptionId, date, time, reason, new Date().toISOString());
}

/**
 * Skips one upcoming visit without cancelling the plan. The client sends the
 * date it showed as "next", so a double-click never skips two visits.
 * Billing rule: a skipped visit's booking is removed, so it is never charged.
 * Visits today or earlier, and completed visits, cannot be skipped.
 */
export function skipSubscriptionVisit(
  subscriptionId: string,
  customerEmail: string,
  date: string,
  confirmAccepted = false,
): SubscriptionChangeResult {
  const today = localDateString();
  return withTransaction(() => {
    const database = getDatabase();
    const sub = findOwnedSubscription(subscriptionId, customerEmail);
    if (!sub) return { status: "not-found", error: "Recurring plan not found." };
    if (sub.status === "cancelled") {
      return { status: "conflict", error: "This plan has been cancelled." };
    }
    if (!isBookableDate(date) || date <= today) {
      return {
        status: "invalid",
        error: "Only visits after today can be skipped.",
      };
    }

    const alreadySkipped = database
      .prepare(
        "SELECT reason FROM subscription_skips WHERE subscription_id = ? AND service_date = ?",
      )
      .get(sub.id, date) as { reason: "skip" | "pause" } | undefined;
    if (alreadySkipped) {
      return {
        status: "ok",
        subscription: toCustomerSubscription(sub, today),
        message: `Your ${displayDayAndDate(date)} visit was already skipped.`,
        dates: [],
      };
    }

    const visit = database
      .prepare(
        `SELECT id, service_date, status, accepted_by_id FROM bookings
         WHERE subscription_id = ? AND service_date = ?`,
      )
      .get(sub.id, date) as SubscriptionVisitRow | undefined;
    if (!visit) {
      return { status: "invalid", error: "There is no visit on that date to skip." };
    }
    if (visit.status === "completed") {
      return { status: "conflict", error: "That visit has already been completed." };
    }
    if (visit.accepted_by_id && !confirmAccepted) {
      return {
        status: "needs-confirmation",
        error: `A cleaner has already accepted your ${displayDayAndDate(date)} visit. If you skip it, they lose this job.`,
        dates: [date],
      };
    }

    database.prepare("DELETE FROM bookings WHERE id = ?").run(visit.id);
    recordSkip(sub.id, date, sub.time_slot, "skip");

    const updated = toCustomerSubscription(sub, today);
    const nextText = updated.nextVisit
      ? ` Your next cleaning is ${displayDayAndDate(updated.nextVisit.date)}.`
      : " There are no more visits left on this plan.";
    return {
      status: "ok",
      subscription: updated,
      message: `Skipped your ${displayDayAndDate(date)} visit. You won't be charged for it.${nextText}`,
      dates: [date],
    };
  });
}

/**
 * Pauses a plan until `resumeDate`: every not-yet-completed visit after today
 * and before the resume date is removed (not charged). Visits on or after the
 * resume date stay booked, so the plan restarts by itself.
 */
export function pauseSubscription(
  subscriptionId: string,
  customerEmail: string,
  resumeDate: string,
  confirmAccepted = false,
): SubscriptionChangeResult {
  const today = localDateString();
  return withTransaction(() => {
    const database = getDatabase();
    const sub = findOwnedSubscription(subscriptionId, customerEmail);
    if (!sub) return { status: "not-found", error: "Recurring plan not found." };
    if (sub.status === "cancelled") {
      return { status: "conflict", error: "This plan has been cancelled." };
    }
    if (planStatus(sub, today) === "paused") {
      return {
        status: "conflict",
        error: `This plan is already paused until ${displayDayAndDate(sub.paused_until!)}. Resume it first to pick a new date.`,
      };
    }
    if (!isBookableDate(resumeDate) || resumeDate <= today) {
      return { status: "invalid", error: "Choose a resume date after today." };
    }
    if (resumeDate > addDaysToDateString(today, MAX_PAUSE_DAYS)) {
      return {
        status: "invalid",
        error: `You can pause for up to ${MAX_PAUSE_DAYS} days.`,
      };
    }

    const visits = database
      .prepare(
        `SELECT id, service_date, status, accepted_by_id FROM bookings
         WHERE subscription_id = ? AND status = 'scheduled'
           AND service_date > ? ORDER BY service_date ASC`,
      )
      .all(sub.id, today) as SubscriptionVisitRow[];
    const lastVisit = visits[visits.length - 1]?.service_date;
    if (!lastVisit) {
      return { status: "conflict", error: "There are no upcoming visits to pause." };
    }
    if (resumeDate > lastVisit) {
      return {
        status: "invalid",
        error: `Choose a resume date on or before your last scheduled visit (${displayDayAndDate(lastVisit)}).`,
      };
    }

    const paused = visits.filter((visit) => visit.service_date < resumeDate);
    const accepted = paused.filter((visit) => visit.accepted_by_id);
    if (accepted.length && !confirmAccepted) {
      const dates = accepted.map((visit) => visit.service_date);
      return {
        status: "needs-confirmation",
        error:
          `A cleaner has already accepted ${dates.length === 1 ? "your" : `${dates.length} of your`} ` +
          `${dates.map(displayDayAndDate).join(", ")} visit${dates.length === 1 ? "" : "s"}. ` +
          `If you pause, they lose ${dates.length === 1 ? "this job" : "these jobs"}.`,
        dates,
      };
    }
    for (const visit of paused) {
      database.prepare("DELETE FROM bookings WHERE id = ?").run(visit.id);
      recordSkip(sub.id, visit.service_date, sub.time_slot, "pause");
    }
    database
      .prepare("UPDATE subscriptions SET paused_until = ?, paused_at = ? WHERE id = ?")
      .run(resumeDate, new Date().toISOString(), sub.id);

    const updated = toCustomerSubscription(
      { ...sub, paused_until: resumeDate },
      today,
    );
    const count = paused.length;
    return {
      status: "ok",
      subscription: updated,
      message:
        `Your plan is paused until ${displayDayAndDate(resumeDate)}. ` +
        (count
          ? `${count} visit${count === 1 ? "" : "s"} won't happen and won't be charged.`
          : "No visits fall in that period."),
      dates: paused.map((visit) => visit.service_date),
    };
  });
}

/**
 * Ends a pause early. Paused visits that are still in the future are booked
 * again when their time slot is free and a cleaner works that day; any that
 * can't be restored are listed so the customer knows.
 */
export function resumeSubscription(
  subscriptionId: string,
  customerEmail: string,
): SubscriptionChangeResult {
  const today = localDateString();
  return withTransaction(() => {
    const database = getDatabase();
    const sub = findOwnedSubscription(subscriptionId, customerEmail);
    if (!sub) return { status: "not-found", error: "Recurring plan not found." };
    if (planStatus(sub, today) !== "paused") {
      return { status: "conflict", error: "This plan isn't paused." };
    }

    const pausedVisits = database
      .prepare(
        `SELECT id, service_date FROM subscription_skips
         WHERE subscription_id = ? AND reason = 'pause' AND service_date > ?
         ORDER BY service_date ASC`,
      )
      .all(sub.id, today) as Array<{ id: string; service_date: string }>;

    const restored: string[] = [];
    const unavailable: string[] = [];
    const servicedDays = getServicedWeekdays();
    // US-13: every visit of a plan carries the same note; copy it onto the
    // visits we put back (pausing guarantees at least one visit remains).
    const note = (
      database
        .prepare(
          `SELECT special_instructions FROM bookings
           WHERE subscription_id = ? AND special_instructions IS NOT NULL LIMIT 1`,
        )
        .get(sub.id) as { special_instructions: string } | undefined
    )?.special_instructions ?? null;
    for (const skip of pausedVisits) {
      const taken = database
        .prepare("SELECT id FROM bookings WHERE service_date = ? AND time_slot = ?")
        .get(skip.service_date, sub.time_slot);
      if (taken || !servicedDays.has(getDayOfWeekFromDateString(skip.service_date))) {
        unavailable.push(skip.service_date);
        continue;
      }
      database
        .prepare(
          `INSERT INTO bookings (
            id, name, email, service_id, service_name, price_cents,
            service_date, time_slot, address, special_instructions, created_at,
            cleaner_id, status, subscription_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
        )
        .run(
          randomUUID(),
          sub.name,
          sub.email,
          sub.service_id,
          sub.service_name,
          sub.price_cents,
          skip.service_date,
          sub.time_slot,
          sub.address,
          note,
          new Date().toISOString(),
          sub.cleaner_id,
          sub.id,
        );
      database.prepare("DELETE FROM subscription_skips WHERE id = ?").run(skip.id);
      restored.push(skip.service_date);
    }

    database
      .prepare("UPDATE subscriptions SET paused_until = NULL, paused_at = NULL WHERE id = ?")
      .run(sub.id);

    const updated = toCustomerSubscription({ ...sub, paused_until: null }, today);
    let message = "Your plan is active again.";
    if (restored.length) {
      message += ` ${restored.length} paused visit${restored.length === 1 ? " is" : "s are"} back on your schedule.`;
    }
    if (unavailable.length) {
      message += ` ${unavailable.map(displayDayAndDate).join(", ")} could not be restored because that time is no longer available.`;
    }
    return { status: "ok", subscription: updated, message, dates: restored };
  });
}

/** "14:00" -> "2:00 PM", matching how the customer page shows arrival windows. */
function displaySlotTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

function displayDayAndDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return `${getDayNameFromDateString(date)}, ${label}`;
}

/* ------------------------------------------------------------------ */
/* AI-01A: recommended cleaner for a chosen date and arrival window.   */
/* Rule-based score, not machine learning.                             */
/* ------------------------------------------------------------------ */

/**
 * Scoring rule from the AI-01A card. The weights, the job cap and the
 * fallback threshold are still assumptions waiting for the Product Owner,
 * so they live here in one place.
 */
export const RECOMMENDATION_RULES = {
  ratingWeight: 0.7,
  experienceWeight: 0.3,
  jobCap: 20,
  fallbackMinRating: 4.0,
} as const;

export type RecommendedCleaner = {
  cleanerId: string;
  name: string;
  averageRating: number | null;
  reviewCount: number;
  completedJobs: number;
  jobsThisWeek: number;
  score: number;
  /** "score": highest score among cleaners rated 4.0+; "fallback": fewest jobs this week. */
  reason: "score" | "fallback";
};

/** Score = 0.7 × rating + 0.3 × 5 × min(jobs, 20) ÷ 20. An unrated cleaner counts as 0 stars. */
export function scoreCleaner(averageRating: number | null, completedJobs: number) {
  const { ratingWeight, experienceWeight, jobCap } = RECOMMENDATION_RULES;
  const rating = averageRating ?? 0;
  const experience = (5 * Math.min(Math.max(completedJobs, 0), jobCap)) / jobCap;
  return Math.round((ratingWeight * rating + experienceWeight * experience) * 1000) / 1000;
}

/** Monday and Sunday of the week that contains `date` (YYYY-MM-DD). */
function weekBounds(date: string) {
  const sinceMonday = (getDayOfWeekFromDateString(date) + 6) % 7;
  const monday = addDaysToDateString(date, -sinceMonday);
  return { monday, sunday: addDaysToDateString(monday, 6) };
}

/**
 * Picks the cleaner to recommend for `date` at `time`, or null when nobody is eligible.
 *
 * Eligible = an active cleaner account, works that weekday, and has no other job
 * in that slot. Among cleaners rated 4.0 or more the highest score wins (ties: more
 * completed jobs, then name). If none is rated 4.0+, the eligible cleaner with the
 * fewest jobs that week is shown instead (ties: name).
 */
export function getRecommendedCleaner(
  date: string,
  time: BookingTime,
): RecommendedCleaner | null {
  const weekday = getDayOfWeekFromDateString(date);
  const { monday, sunday } = weekBounds(date);

  const rows = getDatabase()
    .prepare(
      `SELECT
        cleaners.id AS cleaner_id,
        users.name,
        cleaners.available_days,
        (SELECT AVG(r.stars) FROM ratings r WHERE r.cleaner_id = cleaners.id) AS average_rating,
        (SELECT COUNT(*) FROM ratings r WHERE r.cleaner_id = cleaners.id) AS review_count,
        (SELECT COUNT(*) FROM bookings b
          WHERE b.accepted_by_id = cleaners.id AND b.status = 'completed') AS completed_jobs,
        (SELECT COUNT(*) FROM bookings b
          WHERE b.accepted_by_id = cleaners.id
            AND b.service_date BETWEEN ? AND ?) AS jobs_this_week,
        (SELECT COUNT(*) FROM bookings b
          WHERE b.accepted_by_id = cleaners.id
            AND b.service_date = ? AND b.time_slot = ?) AS jobs_in_slot
      FROM users
      JOIN cleaners ON cleaners.id = users.cleaner_id
      WHERE users.role = 'cleaner' AND users.status = 'active'`,
    )
    .all(monday, sunday, date, time) as Array<{
    cleaner_id: string;
    name: string;
    available_days: string;
    average_rating: number | null;
    review_count: number;
    completed_jobs: number;
    jobs_this_week: number;
    jobs_in_slot: number;
  }>;

  const eligible = rows
    .filter(
      (row) =>
        parseWeekdays(row.available_days).includes(weekday) && row.jobs_in_slot === 0,
    )
    .map((row) => {
      const averageRating =
        row.average_rating === null ? null : Math.round(row.average_rating * 10) / 10;
      return {
        cleanerId: row.cleaner_id,
        name: row.name,
        averageRating,
        reviewCount: row.review_count,
        completedJobs: row.completed_jobs,
        jobsThisWeek: row.jobs_this_week,
        // Score and threshold use the exact average, not the rounded one shown to customers.
        exactRating: row.average_rating,
        score: scoreCleaner(row.average_rating, row.completed_jobs),
      };
    });

  if (eligible.length === 0) return null;

  const wellRated = eligible.filter(
    (cleaner) =>
      cleaner.exactRating !== null &&
      cleaner.exactRating >= RECOMMENDATION_RULES.fallbackMinRating,
  );

  let pick: (typeof eligible)[number];
  let reason: RecommendedCleaner["reason"];
  if (wellRated.length > 0) {
    wellRated.sort(
      (a, b) =>
        b.score - a.score ||
        b.completedJobs - a.completedJobs ||
        a.name.localeCompare(b.name),
    );
    [pick, reason] = [wellRated[0], "score"];
  } else {
    eligible.sort(
      (a, b) => a.jobsThisWeek - b.jobsThisWeek || a.name.localeCompare(b.name),
    );
    [pick, reason] = [eligible[0], "fallback"];
  }

  const { exactRating: _exactRating, ...shown } = pick;
  void _exactRating;
  return { ...shown, reason };
}
