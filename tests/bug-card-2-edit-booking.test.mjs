import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  acceptBookingRequest,
  addDaysToDateString,
  createBooking,
  createRecurringSubscription,
  createUserSession,
  editCustomerBooking,
  getAvailableBookingRequests,
  getCleanerBookings,
  getCustomerBookings,
  getDatabase,
  getDayNameFromDateString,
  getUserByEmail,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import { getServiceStartTime } from "../src/lib/services.ts";
import { POST as editPOST } from "../src/app/api/bookings/[id]/edit/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const CUSTOMER = "customer@saiping.com";
const HOUR = 60 * 60 * 1000;

/** A date far enough ahead that the 24-hour rule always allows editing. */
const farDate = (days = 10) => addDaysToDateString(localDateString(), days);

function book({ date = farDate(), time = "09:00", email = CUSTOMER } = {}) {
  const result = createBooking({
    name: "Alice Customer",
    email,
    serviceId: "deep",
    date,
    time,
    address: "12 Sukhumvit Soi 24, Bangkok",
  });
  assert.equal(result.status, "created");
  return result.booking;
}

function cookieFor(email) {
  return `session_token=${createUserSession(getUserByEmail(email).id).token}`;
}

function editRequest(id, body, email = CUSTOMER) {
  const headers = { "content-type": "application/json" };
  if (email) headers.cookie = cookieFor(email);
  return editPOST(
    new Request(`http://localhost/api/bookings/${id}/edit`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function addCustomer(email) {
  getDatabase()
    .prepare(
      `INSERT INTO users (id, email, password_hash, name, role, cleaner_id, status, created_at)
       VALUES (?, ?, 'x', 'Other Customer', 'customer', NULL, 'active', ?)`,
    )
    .run(`user-${email}`, email, new Date().toISOString());
}

describe("Bug Card 2: customer can edit a booking", () => {
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

  describe("editCustomerBooking", () => {
    test("changes the date, time and instructions, and shows up on the booking", () => {
      const booking = book();
      const newDate = farDate(12);
      const result = editCustomerBooking(booking.id, CUSTOMER, {
        date: newDate,
        time: "14:00",
        specialInstructions: "Please use the side gate.",
      });

      assert.equal(result.status, "edited");
      assert.equal(result.booking.date, newDate);
      assert.equal(result.booking.time, "14:00");
      assert.equal(result.booking.specialInstructions, "Please use the side gate.");
      assert.match(result.message, /moved to/);

      const mine = getCustomerBookings(CUSTOMER).bookings.find((b) => b.id === booking.id);
      assert.equal(mine.date, newDate);
      assert.equal(mine.time, "14:00");
    });

    test("changing only special instructions keeps the original date and time", () => {
      const booking = book();
      const result = editCustomerBooking(booking.id, CUSTOMER, {
        date: booking.date,
        time: booking.time,
        specialInstructions: "Our cat hides under the bed.",
      });
      assert.equal(result.status, "edited");
      assert.equal(result.booking.date, booking.date);
      assert.equal(result.booking.time, booking.time);
      assert.match(result.message, /instructions have been updated/);
    });

    test("frees the old slot and takes the new one", () => {
      const booking = book({ date: farDate(10), time: "09:00" });
      const newDate = farDate(11);
      const result = editCustomerBooking(booking.id, CUSTOMER, {
        date: newDate,
        time: "14:00",
        specialInstructions: null,
      });
      assert.equal(result.status, "edited");

      // The old slot is free again.
      const again = book({ date: farDate(10), time: "09:00" });
      assert.notEqual(again.id, booking.id);

      // The new slot is now taken by this booking, so a fresh booking there fails.
      const clashResult = createBooking({
        name: "Someone Else",
        email: "someone-else@test.local",
        serviceId: "essential",
        date: newDate,
        time: "14:00",
        address: "Other address",
      });
      assert.equal(clashResult.status, "unavailable");
    });

    test("changing the date un-assigns a cleaner who already accepted it", () => {
      const booking = book();
      const cleaner = getUserByEmail("cleaner@saiping.com");
      acceptBookingRequest(booking.id, cleaner.cleanerId, cleaner.name);
      assert.equal(getCleanerBookings(cleaner.cleanerId).length, 1);

      const result = editCustomerBooking(booking.id, CUSTOMER, {
        date: farDate(15),
        time: booking.time,
        specialInstructions: null,
      });
      assert.equal(result.status, "edited");
      assert.match(result.message, /open request again/);
      assert.equal(getCleanerBookings(cleaner.cleanerId).length, 0);
      assert.equal(getAvailableBookingRequests().length, 1);
    });

    test("changing only instructions keeps the accepted cleaner assigned", () => {
      const booking = book();
      const cleaner = getUserByEmail("cleaner@saiping.com");
      acceptBookingRequest(booking.id, cleaner.cleanerId, cleaner.name);

      const result = editCustomerBooking(booking.id, CUSTOMER, {
        date: booking.date,
        time: booking.time,
        specialInstructions: "Ring the bell twice.",
      });
      assert.equal(result.status, "edited");
      assert.equal(getCleanerBookings(cleaner.cleanerId).length, 1);
      assert.equal(getAvailableBookingRequests().length, 0);
    });

    test("exactly 24 hours before the CURRENT visit is allowed", () => {
      const booking = book();
      const now = new Date(getServiceStartTime(booking.date, booking.time) - 24 * HOUR);
      const result = editCustomerBooking(
        booking.id,
        CUSTOMER,
        { date: farDate(20), time: "14:00", specialInstructions: null },
        now,
      );
      assert.equal(result.status, "edited");
    });

    test("less than 24 hours before the CURRENT visit is refused and nothing changes", () => {
      const booking = book();
      const now = new Date(getServiceStartTime(booking.date, booking.time) - 23 * HOUR);
      const result = editCustomerBooking(
        booking.id,
        CUSTOMER,
        { date: farDate(20), time: "14:00", specialInstructions: "New note" },
        now,
      );
      assert.equal(result.status, "too-late");
      const mine = getCustomerBookings(CUSTOMER).bookings.find((b) => b.id === booking.id);
      assert.equal(mine.date, booking.date);
      assert.equal(mine.specialInstructions, null);
    });

    test("a new date/time less than 24 hours away is refused", () => {
      const booking = book();
      const now = new Date();
      const tooSoon = new Date(now.getTime() + 23 * HOUR);
      const soonDate = tooSoon.toISOString().slice(0, 10);
      const result = editCustomerBooking(
        booking.id,
        CUSTOMER,
        { date: soonDate, time: booking.time, specialInstructions: null },
        now,
      );
      assert.equal(result.status, "invalid");
      assert.match(result.error, /24 hours/);
    });

    test("an already-booked slot is refused as unavailable", () => {
      const booking = book({ date: farDate(10), time: "09:00" });
      book({ date: farDate(12), time: "14:00", email: "bob@test.local" });

      const result = editCustomerBooking(booking.id, CUSTOMER, {
        date: farDate(12),
        time: "14:00",
        specialInstructions: null,
      });
      assert.equal(result.status, "unavailable");
    });

    test("a date with no cleaner working is refused", () => {
      // Create the booking first, while cleaners are active, then suspend
      // every cleaner so the destination date has no one working.
      const booking = book();
      getDatabase().exec("UPDATE users SET status = 'suspended' WHERE role = 'cleaner'");
      const result = editCustomerBooking(booking.id, CUSTOMER, {
        date: farDate(13),
        time: "09:00",
        specialInstructions: null,
      });
      assert.equal(result.status, "invalid");
      assert.match(result.error, /No cleaner works/);
    });

    test("a completed booking can't be edited", () => {
      const booking = book();
      getDatabase().prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").run(booking.id);
      const result = editCustomerBooking(booking.id, CUSTOMER, {
        date: farDate(20),
        time: "09:00",
        specialInstructions: null,
      });
      assert.equal(result.status, "completed");
    });

    test("a recurring-plan visit can't be edited here", () => {
      const startDate = farDate(9);
      const plan = createRecurringSubscription({
        name: "Alice Customer",
        email: CUSTOMER,
        serviceId: "essential",
        address: "12 Sukhumvit Soi 24, Bangkok",
        frequency: "weekly",
        preferredDay: getDayNameFromDateString(startDate),
        startDate,
        occurrences: 2,
        time: "14:00",
      });
      assert.equal(plan.status, "created");
      const visit = plan.bookings[0];
      const result = editCustomerBooking(visit.id, CUSTOMER, {
        date: visit.date,
        time: visit.time,
        specialInstructions: "test",
      });
      assert.equal(result.status, "recurring");
    });

    test("another customer's booking is reported as not found", () => {
      const booking = book();
      const result = editCustomerBooking(booking.id, "someone@example.com", {
        date: farDate(20),
        time: "09:00",
        specialInstructions: null,
      });
      assert.equal(result.status, "not-found");
      const mine = getCustomerBookings(CUSTOMER).bookings.find((b) => b.id === booking.id);
      assert.equal(mine.date, booking.date);
    });

    test("canEdit matches canCancel: true far ahead, false for a visit today", () => {
      book();
      getDatabase()
        .prepare(
          `INSERT INTO bookings (id, name, email, service_id, service_name, price_cents,
             service_date, time_slot, address, created_at, status)
           VALUES ('today-1', 'Alice', ?, 'deep', 'Deep clean', 14900, ?, '14:00', 'Addr', ?, 'scheduled')`,
        )
        .run(CUSTOMER, localDateString(), new Date().toISOString());

      const byId = Object.fromEntries(getCustomerBookings(CUSTOMER).bookings.map((b) => [b.id, b]));
      const far = Object.values(byId).find((b) => b.id !== "today-1");
      assert.equal(far.canEdit, true);
      assert.equal(byId["today-1"].canEdit, false);
    });
  });

  describe("POST /api/bookings/[id]/edit", () => {
    test("200 with the updated booking", async () => {
      const booking = book();
      const newDate = farDate(14);
      const response = await editRequest(booking.id, {
        date: newDate,
        time: "14:00",
        specialInstructions: "Leave key with the doorman.",
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.booking.date, newDate);
      assert.equal(body.booking.specialInstructions, "Leave key with the doorman.");
    });

    test("400 for a missing or malformed date/time", async () => {
      const booking = book();
      assert.equal((await editRequest(booking.id, { time: "09:00" })).status, 400);
      assert.equal((await editRequest(booking.id, { date: "not-a-date", time: "09:00" })).status, 400);
      assert.equal((await editRequest(booking.id, { date: farDate(5), time: "11:11" })).status, 400);
    });

    test("400 for special instructions over the limit", async () => {
      const booking = book();
      const response = await editRequest(booking.id, {
        date: booking.date,
        time: booking.time,
        specialInstructions: "x".repeat(400),
      });
      assert.equal(response.status, 400);
    });

    test("401 when signed out", async () => {
      const booking = book();
      const response = await editRequest(
        booking.id,
        { date: farDate(5), time: "09:00", specialInstructions: null },
        null,
      );
      assert.equal(response.status, 401);
    });

    test("401 when only an email is sent instead of a session", async () => {
      const booking = book();
      const response = await editPOST(
        new Request(`http://localhost/api/bookings/${booking.id}/edit`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-customer-email": CUSTOMER },
          body: JSON.stringify({ date: farDate(5), time: "09:00", specialInstructions: null }),
        }),
        { params: Promise.resolve({ id: booking.id }) },
      );
      assert.equal(response.status, 401);
    });

    test("403 for a cleaner or the admin", async () => {
      const booking = book();
      const body = { date: farDate(5), time: "09:00", specialInstructions: null };
      assert.equal((await editRequest(booking.id, body, "cleaner@saiping.com")).status, 403);
      assert.equal((await editRequest(booking.id, body, "admin@saiping.com")).status, 403);
    });

    test("404 for another customer's booking and an unknown id", async () => {
      const booking = book();
      addCustomer("bob@example.com");
      const body = { date: farDate(5), time: "09:00", specialInstructions: null };
      assert.equal((await editRequest(booking.id, body, "bob@example.com")).status, 404);
      assert.equal((await editRequest("does-not-exist", body)).status, 404);
    });

    test("409 when the current visit is less than 24 hours away", async () => {
      getDatabase()
        .prepare(
          `INSERT INTO bookings (id, name, email, service_id, service_name, price_cents,
             service_date, time_slot, address, created_at, status)
           VALUES ('soon-1', 'Alice', ?, 'deep', 'Deep clean', 14900, ?, '14:00', 'Addr', ?, 'scheduled')`,
        )
        .run(CUSTOMER, localDateString(), new Date().toISOString());

      const response = await editRequest("soon-1", {
        date: farDate(10),
        time: "09:00",
        specialInstructions: null,
      });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /at least 24 hours/);
    });

    test("409 for a completed booking", async () => {
      const booking = book();
      getDatabase().prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").run(booking.id);
      const response = await editRequest(booking.id, {
        date: farDate(10),
        time: "09:00",
        specialInstructions: null,
      });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /already been completed/);
    });

    test("409 for a recurring-plan visit, pointing to Manage Plan", async () => {
      const startDate = farDate(9);
      const plan = createRecurringSubscription({
        name: "Alice Customer",
        email: CUSTOMER,
        serviceId: "essential",
        address: "12 Sukhumvit Soi 24, Bangkok",
        frequency: "weekly",
        preferredDay: getDayNameFromDateString(startDate),
        startDate,
        occurrences: 2,
        time: "14:00",
      });
      const visit = plan.bookings[0];
      const response = await editRequest(visit.id, {
        date: visit.date,
        time: visit.time,
        specialInstructions: "test",
      });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /Manage Plan/);
    });

    test("409 when the chosen slot is already taken", async () => {
      const booking = book({ date: farDate(10), time: "09:00" });
      book({ date: farDate(12), time: "14:00", email: "bob2@test.local" });
      const response = await editRequest(booking.id, {
        date: farDate(12),
        time: "14:00",
        specialInstructions: null,
      });
      assert.equal(response.status, 409);
    });
  });
});
