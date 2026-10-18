import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SERVICES,
  TIME_SLOTS,
  type BookingTime,
  type ServiceId,
} from "@/lib/services";

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
};

const globalForSqlite = globalThis as typeof globalThis & {
  cleaningDatabase?: DatabaseSync;
};

function getDatabase() {
  if (!globalForSqlite.cleaningDatabase) {
    const dataDirectory = path.join(process.cwd(), "data");
    mkdirSync(dataDirectory, { recursive: true });

    const database = new DatabaseSync(
      path.join(dataDirectory, "bookings.sqlite"),
    );
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec("PRAGMA journal_mode = WAL;");
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

    database.exec(`
      CREATE TABLE IF NOT EXISTS ratings (
        id TEXT PRIMARY KEY,
        booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
        cleaner_id TEXT NOT NULL REFERENCES cleaners(id),
        stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
        created_at TEXT NOT NULL
      );
    `);
    globalForSqlite.cleaningDatabase = database;
  }

  return globalForSqlite.cleaningDatabase;
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
