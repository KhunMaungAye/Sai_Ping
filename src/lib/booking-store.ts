import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SERVICES,
  TIME_SLOTS,
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
  createdAt: string;
  cleanerId: string;
  cleanerName: string;
  status: "scheduled" | "completed";
  statusLabel: string;
  subscriptionId: string | null;
  rating: number | null;
  isUpcoming: boolean;
};

export type BookingRatingDetails = {
  id: string;
  serviceName: string;
  date: string;
  status: "scheduled" | "completed";
  cleanerId: string;
  cleanerName: string;
  rating: number | null;
};

export type SubscriptionInput = {
  name: string;
  email: string;
  serviceId: ServiceId;
  address: string;
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
      created_at TEXT NOT NULL,
      cleaner_id TEXT NOT NULL DEFAULT '${DEFAULT_CLEANER.id}' REFERENCES cleaners(id),
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed')),
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

    INSERT OR IGNORE INTO users (id, email, password_hash, name, role, cleaner_id, status, created_at)
    VALUES 
      ('user-customer-001', 'customer@saiping.com', '$2b$10$ToODN36bWH81uUipsUSRyusZosG/NjJPRN1HJaEuN8hMY.5W8oqvK', 'Alice Customer', 'customer', NULL, 'active', '2026-01-01T00:00:00.000Z'),
      ('user-cleaner-001', 'cleaner@saiping.com', '$2b$10$L3zIng8mu2OrkBZWfjbtQex/goPsLYva5C3n/XqnMcRD3qt3xH/CO', 'Sai Ping Cleaner', 'cleaner', '${DEFAULT_CLEANER.id}', 'active', '2026-01-01T00:00:00.000Z'),
      ('user-admin-001', 'admin@saiping.com', '$2b$10$qDP8DUieLBSw2LaudMy.0e4IKK3ssHw21I/VdyuLcsI0425P3zTzm', 'System Administrator', 'admin', NULL, 'active', '2026-01-01T00:00:00.000Z');
  `);
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

export function listAvailableSlots(date: string) {
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

  for (const date of dates) {
    const existing = database
      .prepare(
        "SELECT id FROM bookings WHERE service_date = ? AND time_slot = ?",
      )
      .get(date, time);
    if (existing) {
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
          service_date, time_slot, address, created_at, cleaner_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
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
        createdAt,
        cleaner.id,
      );

    database.exec("COMMIT;");
    return {
      status: "created" as const,
      booking: {
        ...input,
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
    for (const date of dates) {
      const conflict = database
        .prepare(
          "SELECT id FROM bookings WHERE service_date = ? AND time_slot = ?",
        )
        .get(date, input.time);

      if (conflict) {
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
        service_date, time_slot, address, created_at, cleaner_id, status, subscription_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
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
        cleaners.id AS cleaner_id,
        cleaners.name AS cleaner_name,
        ratings.stars AS rating
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
        cleaner_id: string;
        cleaner_name: string;
        rating: number | null;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    serviceName: row.service_name,
    date: row.service_date,
    status: row.status,
    cleanerId: row.cleaner_id,
    cleanerName: row.cleaner_name,
    rating: row.rating,
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

export function submitBookingRating(id: string, stars: number) {
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
        "INSERT INTO ratings (id, booking_id, cleaner_id, stars, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        id,
        booking.cleaner_id,
        stars,
        new Date().toISOString(),
      );
    database.exec("COMMIT;");
    return { status: "rated" as const, stars };
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
        bookings.created_at,
        bookings.cleaner_id,
        cleaners.name AS cleaner_name,
        bookings.status,
        bookings.subscription_id,
        ratings.stars AS rating
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
      created_at: string;
      cleaner_id: string;
      cleaner_name: string;
      status: "scheduled" | "completed";
      subscription_id: string | null;
      rating: number | null;
    }>;

  const today = localDateString();

  const all: CustomerBooking[] = rows.map((row) => {
    const isUpcoming = row.status === "scheduled" && row.service_date >= today;
    const statusLabel = row.status === "completed" ? "Completed" : "Scheduled";

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
      createdAt: row.created_at,
      cleanerId: row.cleaner_id,
      cleanerName: row.cleaner_name,
      status: row.status,
      statusLabel,
      subscriptionId: row.subscription_id ?? null,
      rating: row.rating ?? null,
      isUpcoming,
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
  };
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
        bookings.created_at,
        bookings.cleaner_id,
        cleaners.name AS cleaner_name,
        bookings.status,
        bookings.subscription_id,
        ratings.stars AS rating
      FROM bookings
      JOIN cleaners ON cleaners.id = bookings.cleaner_id
      LEFT JOIN ratings ON ratings.booking_id = bookings.id
      WHERE bookings.cleaner_id = ?
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
      created_at: string;
      cleaner_id: string;
      cleaner_name: string;
      status: "scheduled" | "completed";
      subscription_id: string | null;
      rating: number | null;
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
    createdAt: row.created_at,
    cleanerId: row.cleaner_id,
    cleanerName: row.cleaner_name,
    status: row.status,
    statusLabel: row.status === "completed" ? "Completed" : "Scheduled",
    subscriptionId: row.subscription_id ?? null,
    rating: row.rating ?? null,
    isUpcoming: row.status === "scheduled" && row.service_date >= today,
  }));
}

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
        bookings.created_at,
        bookings.cleaner_id,
        cleaners.name AS cleaner_name,
        bookings.status,
        bookings.subscription_id,
        ratings.stars AS rating
      FROM bookings
      JOIN cleaners ON cleaners.id = bookings.cleaner_id
      LEFT JOIN ratings ON ratings.booking_id = bookings.id
      ORDER BY bookings.service_date DESC, bookings.time_slot ASC`
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
      created_at: string;
      cleaner_id: string;
      cleaner_name: string;
      status: "scheduled" | "completed";
      subscription_id: string | null;
      rating: number | null;
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
    createdAt: row.created_at,
    cleanerId: row.cleaner_id,
    cleanerName: row.cleaner_name,
    status: row.status,
    statusLabel: row.status === "completed" ? "Completed" : "Scheduled",
    subscriptionId: row.subscription_id ?? null,
    rating: row.rating ?? null,
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

