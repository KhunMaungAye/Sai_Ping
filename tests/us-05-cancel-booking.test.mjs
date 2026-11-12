import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  acceptBookingRequest,
  addDaysToDateString,
  cancelCustomerBooking,
  createBooking,
  createRecurringSubscription,
  createUserSession,
  getAvailableBookingRequests,
  getCleanerBookings,
  getCustomerBookings,
  getDatabase,
  getDayNameFromDateString,
  getUserByEmail,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import {
  getServiceStartTime,
  isWithinCancellationWindow,
} from "../src/lib/services.ts";
import { POST as cancelPOST } from "../src/app/api/bookings/[id]/cancel/route.ts";
import { GET as bookingsGET } from "../src/app/api/bookings/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const CUSTOMER = "customer@saiping.com";
const HOUR = 60 * 60 * 1000;

/** A date far enough ahead that the 24-hour rule always allows cancelling. */
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

function cancelRequest(id, email = CUSTOMER) {
  const headers = {};
  if (email) headers.cookie = cookieFor(email);
  return cancelPOST(
    new Request(`http://localhost/api/bookings/${id}/cancel`, { method: "POST", headers }),
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

describe("US-05 Cancel cleaning booking", () => {
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

  describe("24-hour rule (Bangkok time)", () => {
    test("a visit's start time is read as Bangkok time (UTC+7)", () => {
      assert.equal(
        getServiceStartTime("2026-11-20", "09:00").toISOString(),
        "2026-11-20T02:00:00.000Z",
      );
    });

    test("more than 24 hours before is allowed", () => {
      const start = getServiceStartTime("2026-11-20", "09:00");
      assert.equal(isWithinCancellationWindow("2026-11-20", "09:00", new Date(start - 30 * HOUR)), true);
    });

    test("exactly 24 hours before is allowed", () => {
      const start = getServiceStartTime("2026-11-20", "14:00");
      assert.equal(isWithinCancellationWindow("2026-11-20", "14:00", new Date(start - 24 * HOUR)), true);
    });

    test("one minute under 24 hours is refused", () => {
      const start = getServiceStartTime("2026-11-20", "14:00");
      assert.equal(
        isWithinCancellationWindow("2026-11-20", "14:00", new Date(start - 24 * HOUR + 60 * 1000)),
        false,
      );
    });

    test("a visit that already started is refused", () => {
      const start = getServiceStartTime("2026-11-20", "09:00");
      assert.equal(isWithinCancellationWindow("2026-11-20", "09:00", new Date(start + HOUR)), false);
    });
  });

  describe("cancelCustomerBooking", () => {
    test("cancels, frees the arrival window and keeps a record", () => {
      const booking = book();
      const result = cancelCustomerBooking(booking.id, CUSTOMER);

      assert.equal(result.status, "cancelled");
      assert.match(result.message, /has been cancelled/);
      assert.match(result.message, /won't be charged/);
      assert.match(result.message, /at 9:00\sAM has been cancelled/);

      const mine = getCustomerBookings(CUSTOMER);
      assert.equal(mine.bookings.length, 0);
      assert.equal(mine.cancelled.length, 1);
      assert.equal(mine.cancelled[0].id, booking.id);
      assert.equal(mine.cancelled[0].date, booking.date);

      // The same window can be booked again by anyone.
      const again = book({ date: booking.date, time: booking.time });
      assert.notEqual(again.id, booking.id);
    });

    test("exactly 24 hours before the visit is allowed", () => {
      const booking = book();
      const now = new Date(getServiceStartTime(booking.date, booking.time) - 24 * HOUR);
      assert.equal(cancelCustomerBooking(booking.id, CUSTOMER, now).status, "cancelled");
    });

    test("less than 24 hours before the visit is refused and nothing changes", () => {
      const booking = book();
      const now = new Date(getServiceStartTime(booking.date, booking.time) - 23 * HOUR);
      assert.equal(cancelCustomerBooking(booking.id, CUSTOMER, now).status, "too-late");
      assert.equal(getCustomerBookings(CUSTOMER).bookings.length, 1);
      assert.equal(getCustomerBookings(CUSTOMER).cancelled.length, 0);
    });

    test("an accepted booking leaves the cleaner's job list when cancelled", () => {
      const booking = book();
      const cleaner = getUserByEmail("cleaner@saiping.com");
      acceptBookingRequest(booking.id, cleaner.cleanerId, cleaner.name);
      assert.equal(getCleanerBookings(cleaner.cleanerId).length, 1);

      assert.equal(cancelCustomerBooking(booking.id, CUSTOMER).status, "cancelled");
      assert.equal(getCleanerBookings(cleaner.cleanerId).length, 0);
    });

    test("an open request leaves Available Requests when cancelled", () => {
      const booking = book();
      assert.equal(getAvailableBookingRequests().length, 1);
      cancelCustomerBooking(booking.id, CUSTOMER);
      assert.equal(getAvailableBookingRequests().length, 0);
    });

    test("a completed booking can't be cancelled", () => {
      const booking = book();
      getDatabase().prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").run(booking.id);
      assert.equal(cancelCustomerBooking(booking.id, CUSTOMER).status, "completed");
    });

    test("a recurring-plan visit can't be cancelled here (Skip is used instead)", () => {
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
      assert.equal(cancelCustomerBooking(visit.id, CUSTOMER).status, "recurring");
    });

    test("another customer's booking is reported as not found", () => {
      const booking = book();
      assert.equal(cancelCustomerBooking(booking.id, "someone@example.com").status, "not-found");
      assert.equal(getCustomerBookings(CUSTOMER).bookings.length, 1);
    });

    test("cancelling twice: the retry reports the earlier cancellation, no duplicate", () => {
      const booking = book();
      assert.equal(cancelCustomerBooking(booking.id, CUSTOMER).status, "cancelled");
      const retry = cancelCustomerBooking(booking.id, CUSTOMER);
      assert.equal(retry.status, "already-cancelled");
      assert.equal(retry.booking.id, booking.id);
      assert.equal(getCustomerBookings(CUSTOMER).cancelled.length, 1);
      // Another customer still can't learn about it.
      assert.equal(cancelCustomerBooking(booking.id, "someone@example.com").status, "not-found");
    });

    test("canCancel is true far ahead and false for a visit today", () => {
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
      assert.equal(far.canCancel, true);
      assert.equal(byId["today-1"].canCancel, false);
    });
  });

  describe("POST /api/bookings/[id]/cancel", () => {
    test("200 with the confirmation message, and GET /api/bookings lists it as cancelled", async () => {
      const booking = book();
      const response = await cancelRequest(booking.id);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.match(body.message, /has been cancelled/);
      assert.equal(body.booking.id, booking.id);

      const list = await bookingsGET(
        new Request("http://localhost/api/bookings", { headers: { cookie: cookieFor(CUSTOMER) } }),
      );
      const data = await list.json();
      assert.equal(data.upcoming.length, 0);
      assert.equal(data.cancelled.length, 1);
      assert.equal(data.cancelled[0].id, booking.id);
    });

    test("a retried request gets 200 again, not an error", async () => {
      const booking = book();
      assert.equal((await cancelRequest(booking.id)).status, 200);
      const retry = await cancelRequest(booking.id);
      assert.equal(retry.status, 200);
      assert.match((await retry.json()).message, /already cancelled/);
    });

    test("401 when only an email is sent instead of a session (no email-only sign-in)", async () => {
      const booking = book();
      const asEmail = (headers) =>
        cancelPOST(
          new Request(`http://localhost/api/bookings/${booking.id}/cancel`, { method: "POST", headers }),
          { params: Promise.resolve({ id: booking.id }) },
        );
      assert.equal((await asEmail({ "x-customer-email": CUSTOMER })).status, 401);
      assert.equal((await asEmail({ authorization: `Bearer ${CUSTOMER}` })).status, 401);
      assert.equal((await asEmail({ cookie: `session_token=${CUSTOMER}` })).status, 401);
      assert.equal(getCustomerBookings(CUSTOMER).bookings.length, 1);
    });

    test("401 when signed out", async () => {
      const booking = book();
      const response = await cancelRequest(booking.id, null);
      assert.equal(response.status, 401);
      assert.equal(getCustomerBookings(CUSTOMER).bookings.length, 1);
    });

    test("403 for a cleaner or the admin", async () => {
      const booking = book();
      assert.equal((await cancelRequest(booking.id, "cleaner@saiping.com")).status, 403);
      assert.equal((await cancelRequest(booking.id, "admin@saiping.com")).status, 403);
      assert.equal(getCustomerBookings(CUSTOMER).bookings.length, 1);
    });

    test("404 for another customer's booking and for an unknown id", async () => {
      const booking = book();
      addCustomer("bob@example.com");
      assert.equal((await cancelRequest(booking.id, "bob@example.com")).status, 404);
      assert.equal((await cancelRequest("does-not-exist")).status, 404);
      assert.equal(getCustomerBookings(CUSTOMER).bookings.length, 1);
    });

    test("409 when the visit is less than 24 hours away", async () => {
      getDatabase()
        .prepare(
          `INSERT INTO bookings (id, name, email, service_id, service_name, price_cents,
             service_date, time_slot, address, created_at, status)
           VALUES ('soon-1', 'Alice', ?, 'deep', 'Deep clean', 14900, ?, '14:00', 'Addr', ?, 'scheduled')`,
        )
        .run(CUSTOMER, localDateString(), new Date().toISOString());

      const response = await cancelRequest("soon-1");
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /at least 24 hours/);
      assert.equal(getCustomerBookings(CUSTOMER).cancelled.length, 0);
    });

    test("409 for a completed booking", async () => {
      const booking = book();
      getDatabase().prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").run(booking.id);
      const response = await cancelRequest(booking.id);
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /already been completed/);
    });
  });
});
