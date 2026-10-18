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
};

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
    database.exec(`
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
        UNIQUE (service_date, time_slot)
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
  };
}

export function createBooking(input: BookingInput) {
  const database = getDatabase();
  const service = SERVICES.find((item) => item.id === input.serviceId);

  if (!service) throw new Error("Unknown cleaning service");

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
          service_date, time_slot, address, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      },
    };
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function getBooking(id: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM bookings WHERE id = ?")
    .get(id) as StoredBooking | undefined;

  return row ? toBooking(row) : null;
}
