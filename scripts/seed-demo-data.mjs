#!/usr/bin/env node
/**
 * Seeds a few demo accounts and bookings into the LOCAL dev database
 * (`data/bookings.sqlite`, or `DATABASE_PATH` if set).
 *
 * Why: `data/bookings.sqlite` is git-ignored, so every teammate's local
 * database is separate (see README "Accounts" and the project doc). Rather
 * than sharing a database FILE — which can't be merged and would overwrite
 * each other's test data — this script gives everyone the same starting
 * accounts with one command, reusing the exact same demo credentials the
 * automated tests use (see tests/helpers/seed-test-users.mjs), so one set
 * of logins works everywhere: in tests, and in your own local dev server.
 *
 * Usage (from the Sai_Ping project root):
 *   node scripts/seed-demo-data.mjs
 *
 * Safe to run more than once: it skips anything that already exists and
 * never deletes or overwrites existing accounts or bookings.
 */
import {
  addDaysToDateString,
  createUser,
  getDatabase,
  getUserByEmail,
  localDateString,
} from "../src/lib/booking-store.ts";
import { hashPassword } from "../src/lib/auth.ts";

const CLEANER_EVERYDAY = { id: "demo-cleaner-everyday", name: "Sai Ping Cleaner", days: "0,1,2,3,4,5,6" };
const CLEANER_WEEKDAYS = { id: "demo-cleaner-weekdays", name: "Mia Cleaner", days: "1,2,3,4,5" };

const ACCOUNTS = [
  {
    email: "customer@saiping.com",
    password: "CustomerPassword123!",
    name: "Alice Customer",
    role: "customer",
    cleanerId: null,
  },
  {
    email: "cleaner@saiping.com",
    password: "CleanerPassword123!",
    name: CLEANER_EVERYDAY.name,
    role: "cleaner",
    cleanerId: CLEANER_EVERYDAY.id,
  },
  {
    email: "cleaner2@saiping.com",
    password: "Cleaner2Password123!",
    name: CLEANER_WEEKDAYS.name,
    role: "cleaner",
    cleanerId: CLEANER_WEEKDAYS.id,
  },
];

const today = localDateString();
const dateIn = (days) => addDaysToDateString(today, days);

async function seedCleaners(db) {
  for (const cleaner of [CLEANER_EVERYDAY, CLEANER_WEEKDAYS]) {
    db.prepare(
      "INSERT OR IGNORE INTO cleaners (id, name, available_days) VALUES (?, ?, ?)",
    ).run(cleaner.id, cleaner.name, cleaner.days);
  }
}

async function seedAccounts() {
  for (const account of ACCOUNTS) {
    if (getUserByEmail(account.email)) {
      console.log(`  skip  ${account.email} (already exists)`);
      continue;
    }
    const passwordHash = await hashPassword(account.password);
    createUser({
      email: account.email,
      passwordHash,
      name: account.name,
      role: account.role,
      cleanerId: account.cleanerId,
    });
    console.log(`  added ${account.email} / ${account.password}`);
  }
}

/** Inserts a booking row directly, skipping it if that id already exists. */
function seedBooking(db, row) {
  const exists = db.prepare("SELECT id FROM bookings WHERE id = ?").get(row.id);
  if (exists) {
    console.log(`  skip  booking ${row.id} (already exists)`);
    return;
  }
  db.prepare(
    `INSERT INTO bookings (
       id, name, email, service_id, service_name, price_cents, service_date,
       time_slot, address, special_instructions, created_at, cleaner_id,
       status, accepted_by_id, accepted_by_name, accepted_at
     ) VALUES (@id, @name, @email, @service_id, @service_name, @price_cents,
       @service_date, @time_slot, @address, @special_instructions, @created_at,
       @cleaner_id, @status, @accepted_by_id, @accepted_by_name, @accepted_at)`,
  ).run(row);
  console.log(`  added booking ${row.id} (${row.status})`);
}

function seedBookings(db) {
  const customerEmail = "customer@saiping.com";
  const createdAt = new Date().toISOString();

  seedBooking(db, {
    id: "demo-booking-open",
    name: "Alice Customer",
    email: customerEmail,
    service_id: "essential",
    service_name: "Essential clean",
    price_cents: 8900,
    service_date: dateIn(10),
    time_slot: "09:00",
    address: "12 Sukhumvit Soi 24, Bangkok",
    special_instructions: null,
    created_at: createdAt,
    cleaner_id: CLEANER_EVERYDAY.id,
    status: "scheduled",
    accepted_by_id: null,
    accepted_by_name: null,
    accepted_at: null,
  });

  seedBooking(db, {
    id: "demo-booking-accepted",
    name: "Alice Customer",
    email: customerEmail,
    service_id: "deep",
    service_name: "Deep clean",
    price_cents: 14900,
    service_date: dateIn(12),
    time_slot: "14:00",
    address: "12 Sukhumvit Soi 24, Bangkok",
    special_instructions: "Please use the side gate.",
    created_at: createdAt,
    cleaner_id: CLEANER_EVERYDAY.id,
    status: "scheduled",
    accepted_by_id: CLEANER_EVERYDAY.id,
    accepted_by_name: CLEANER_EVERYDAY.name,
    accepted_at: createdAt,
  });

  seedBooking(db, {
    id: "demo-booking-completed",
    name: "Alice Customer",
    email: customerEmail,
    service_id: "essential",
    service_name: "Essential clean",
    price_cents: 8900,
    service_date: dateIn(-5),
    time_slot: "09:00",
    address: "12 Sukhumvit Soi 24, Bangkok",
    special_instructions: null,
    created_at: createdAt,
    cleaner_id: CLEANER_EVERYDAY.id,
    status: "completed",
    accepted_by_id: CLEANER_EVERYDAY.id,
    accepted_by_name: CLEANER_EVERYDAY.name,
    accepted_at: createdAt,
  });

  const existingRating = db
    .prepare("SELECT id FROM ratings WHERE booking_id = ?")
    .get("demo-booking-completed");
  if (!existingRating) {
    db.prepare(
      `INSERT INTO ratings (id, booking_id, cleaner_id, stars, review, created_at)
       VALUES ('demo-rating-completed', 'demo-booking-completed', ?, 5, 'Great job, very thorough!', ?)`,
    ).run(CLEANER_EVERYDAY.id, createdAt);
    console.log("  added rating for demo-booking-completed");
  } else {
    console.log("  skip  rating for demo-booking-completed (already exists)");
  }
}

async function main() {
  const db = getDatabase();
  console.log("Seeding demo accounts...");
  await seedCleaners(db);
  await seedAccounts();
  console.log("Seeding demo bookings...");
  seedBookings(db);
  console.log("\nDone. Sign in at /login with any of:");
  for (const account of ACCOUNTS) {
    console.log(`  ${account.role.padEnd(8)} ${account.email} / ${account.password}`);
  }
  console.log("  admin    admin@saiping.com / AdminPassword123! (seeded automatically)");
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exitCode = 1;
});
