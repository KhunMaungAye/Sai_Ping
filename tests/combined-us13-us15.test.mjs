import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createRecurringSubscription,
  getCustomerBookings,
  getDatabase,
  getDayNameFromDateString,
  getDayOfWeekFromDateString,
  localDateString,
  pauseSubscription,
  resetDatabaseForTesting,
  resumeSubscription,
} from "../src/lib/booking-store.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

test("Visits restored by Resume now keep the customer's special instructions", () => {
  const db = new DatabaseSync(":memory:");
  resetDatabaseForTesting(db);
  seedTestUsers();
  getDatabase();

  let start = addDaysToDateString(localDateString(), 1);
  while (getDayOfWeekFromDateString(start) !== 2) start = addDaysToDateString(start, 1);
  const plan = createRecurringSubscription({
    name: "Alice Customer",
    email: "customer@saiping.com",
    serviceId: "essential",
    address: "12 Sukhumvit Soi 24, Bangkok",
    frequency: "weekly",
    preferredDay: getDayNameFromDateString(start),
    startDate: start,
    occurrences: 3,
    time: "09:00",
    specialInstructions: "Cat inside, keep doors shut.",
  });
  const dates = plan.bookings.map((b) => b.date);

  assert.strictEqual(pauseSubscription(plan.subscription.id, "customer@saiping.com", dates[2]).status, "ok");
  assert.strictEqual(resumeSubscription(plan.subscription.id, "customer@saiping.com").status, "ok");

  const notes = getCustomerBookings("customer@saiping.com").bookings.map((b) => b.specialInstructions);
  assert.deepStrictEqual(notes, Array(3).fill("Cat inside, keep doors shut."));

  resetDatabaseForTesting();
  try {
    db.close();
  } catch {}
});
