import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createUserSession,
  getAvailableBookingRequests,
  getCleanerBookings,
  getCustomerBookings,
  getDatabase,
  getDayOfWeekFromDateString,
  getUserByEmail,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import {
  SPECIAL_INSTRUCTIONS_MAX_LENGTH,
  parseSpecialInstructions,
} from "../src/lib/services.ts";
import { POST as bookingsPOST } from "../src/app/api/bookings/route.ts";
import { POST as subscriptionsPOST } from "../src/app/api/subscriptions/route.ts";
import { POST as acceptPOST } from "../src/app/api/cleaner/bookings/[id]/accept/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

function nextWeekday(weekday) {
  let date = addDaysToDateString(localDateString(), 1);
  while (getDayOfWeekFromDateString(date) !== weekday) {
    date = addDaysToDateString(date, 1);
  }
  return date;
}

function cookieFor(email) {
  return `session_token=${createUserSession(getUserByEmail(email).id).token}`;
}

function book(extra = {}, { time = "09:00", date = nextWeekday(2) } = {}) {
  return bookingsPOST(
    new Request("http://localhost/api/bookings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieFor("customer@saiping.com"),
      },
      body: JSON.stringify({
        name: "Alice Customer",
        email: "customer@saiping.com",
        serviceId: "essential",
        date,
        time,
        address: "12 Sukhumvit Soi 24, Bangkok",
        ...extra,
      }),
    }),
  );
}

describe("US-13 special cleaning instructions", () => {
  let testDb;

  beforeEach(() => {
    testDb = new DatabaseSync(":memory:");
    resetDatabaseForTesting(testDb);
    seedTestUsers();
    getDatabase();
  });

  afterEach(() => {
    resetDatabaseForTesting();
    try {
      testDb.close();
    } catch {}
  });

  test("The limit is 250 characters", () => {
    assert.strictEqual(SPECIAL_INSTRUCTIONS_MAX_LENGTH, 250);
  });

  test("Empty or missing notes are saved as null", async () => {
    const cases = [{}, { specialInstructions: null }, { specialInstructions: "" }, { specialInstructions: "   \n  " }];
    const days = [1, 2, 3, 4];
    for (let i = 0; i < cases.length; i += 1) {
      const res = await book(cases[i], { date: nextWeekday(days[i]) });
      assert.strictEqual(res.status, 201, JSON.stringify(cases[i]));
    }
    const saved = getCustomerBookings("customer@saiping.com").bookings;
    assert.strictEqual(saved.length, 4);
    for (const booking of saved) {
      assert.strictEqual(booking.specialInstructions, null);
    }
  });

  test("A note of exactly 250 characters is saved and trimmed", async () => {
    const note = "x".repeat(250);
    const res = await book({ specialInstructions: `  ${note}  ` });
    assert.strictEqual(res.status, 201);
    const [saved] = getCustomerBookings("customer@saiping.com").bookings;
    assert.strictEqual(saved.specialInstructions, note);
  });

  test("A note over 250 characters is rejected and nothing is booked", async () => {
    const res = await book({ specialInstructions: "x".repeat(251) });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.code, "INSTRUCTIONS_TOO_LONG");
    assert.match(data.error, /250 characters or fewer/);
    assert.strictEqual(getCustomerBookings("customer@saiping.com").bookings.length, 0);
  });

  test("A note that is not text is rejected", async () => {
    const res = await book({ specialInstructions: { evil: true } });
    assert.strictEqual(res.status, 400);
  });

  test("Cleaners see the note on open requests and on accepted jobs", async () => {
    const note = "Side gate code 4821.\nCat hides under the bed — keep the door shut.";
    const res = await book({ specialInstructions: note });
    const { booking } = await res.json();

    const open = getAvailableBookingRequests().find((b) => b.id === booking.id);
    assert.strictEqual(open.specialInstructions, note);

    const accept = await acceptPOST(
      new Request(`http://localhost/api/cleaner/bookings/${booking.id}/accept`, {
        method: "POST",
        headers: { cookie: cookieFor("cleaner@saiping.com") },
      }),
      { params: Promise.resolve({ id: booking.id }) },
    );
    assert.strictEqual(accept.status, 200);

    const job = getCleanerBookings("cleaner-001").find((b) => b.id === booking.id);
    assert.strictEqual(job.specialInstructions, note);
  });

  test("Recurring bookings copy the note to every visit", async () => {
    const res = await book({
      specialInstructions: "Please water the plants.",
      frequency: "weekly",
      preferredDay: "Tuesday",
      occurrences: 3,
    });
    assert.strictEqual(res.status, 201);
    const visits = getCustomerBookings("customer@saiping.com").bookings;
    assert.strictEqual(visits.length, 3);
    for (const visit of visits) {
      assert.strictEqual(visit.specialInstructions, "Please water the plants.");
    }
  });

  test("The recurring-booking route used by the form saves and validates notes", async () => {
    const send = (specialInstructions, time) =>
      subscriptionsPOST(
        new Request("http://localhost/api/subscriptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Alice Customer",
            email: "customer@saiping.com",
            serviceId: "deep",
            address: "12 Sukhumvit Soi 24, Bangkok",
            frequency: "biweekly",
            preferredDay: "Wednesday",
            startDate: nextWeekday(3),
            occurrences: 2,
            time,
            specialInstructions,
          }),
        }),
      );

    assert.strictEqual((await send("z".repeat(251), "09:00")).status, 400);
    assert.strictEqual((await send("Bring your own mop, please.", "14:00")).status, 201);
    const visits = getCustomerBookings("customer@saiping.com").bookings;
    assert.strictEqual(visits.length, 2);
    assert.ok(visits.every((v) => v.specialInstructions === "Bring your own mop, please."));
  });

  test("The shared validator matches the API rules", () => {
    assert.deepStrictEqual(parseSpecialInstructions("  hi  "), { ok: true, value: "hi" });
    assert.deepStrictEqual(parseSpecialInstructions(""), { ok: true, value: null });
    assert.strictEqual(parseSpecialInstructions("y".repeat(251)).ok, false);
    assert.strictEqual(parseSpecialInstructions(42).ok, false);
  });
});
