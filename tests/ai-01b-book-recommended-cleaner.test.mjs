import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createBooking,
  createUserSession,
  getAvailableBookingRequests,
  getCleanerBookings,
  getCustomerBookings,
  getDatabase,
  getDayOfWeekFromDateString,
  getRecommendedCleaner,
  getUserByEmail,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import { POST as bookingsPOST } from "../src/app/api/bookings/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

let dayCounter = 0;
/** A fresh upcoming Monday–Friday date each call, so both seeded cleaners work it. */
function nextWeekday() {
  let date = addDaysToDateString(localDateString(), 2 + dayCounter);
  while (true) {
    dayCounter += 1;
    const day = getDayOfWeekFromDateString(date);
    if (day >= 1 && day <= 5) return date;
    date = addDaysToDateString(date, 1);
  }
}

function sessionCookie(email) {
  const user = getUserByEmail(email);
  assert.ok(user, `seed user ${email} exists`);
  return `session_token=${createUserSession(user.id).token}`;
}

function postBooking(body, cookie = sessionCookie("customer@saiping.com")) {
  return bookingsPOST(
    new Request("http://localhost/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({
        name: "Alice Customer",
        email: "customer@saiping.com",
        serviceId: "essential",
        address: "12 Test Street, Bangkok",
        time: "09:00",
        ...body,
      }),
    }),
  );
}

function bookingCount() {
  return getDatabase().prepare("SELECT COUNT(*) AS n FROM bookings").get().n;
}

describe("AI-01B Book the recommended cleaner in one click", () => {
  beforeEach(() => {
    resetDatabaseForTesting(new DatabaseSync(":memory:"));
    seedTestUsers();
    dayCounter = 0;
  });

  afterEach(() => {
    resetDatabaseForTesting();
  });

  describe("AC 1: Book with [name]", () => {
    test("creates the booking already assigned to the recommended cleaner", async () => {
      const date = nextWeekday();
      const pick = getRecommendedCleaner(date, "09:00");
      assert.ok(pick, "a cleaner is recommended");

      const res = await postBooking({ date, preferredCleanerId: pick.cleanerId, requestId: "req-1" });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.deepEqual(data.assignedCleaner, { id: pick.cleanerId, name: pick.name });
      assert.equal(data.cleanerUnavailable, false);
      assert.equal(data.message, `Booked with ${pick.name}. Your cleaning is confirmed.`);

      const row = getDatabase()
        .prepare("SELECT accepted_by_id, accepted_by_name, accepted_at, cleaner_id FROM bookings WHERE id = ?")
        .get(data.booking.id);
      assert.equal(row.accepted_by_id, pick.cleanerId);
      assert.equal(row.accepted_by_name, pick.name);
      assert.equal(row.cleaner_id, pick.cleanerId);
      assert.ok(row.accepted_at);
    });

    test("the job is in that cleaner's jobs and not in Available Requests", async () => {
      const date = nextWeekday();
      const res = await postBooking({ date, preferredCleanerId: "cleaner-002" });
      const { booking } = await res.json();
      assert.ok(getCleanerBookings("cleaner-002").some((job) => job.id === booking.id));
      assert.ok(!getAvailableBookingRequests().some((job) => job.id === booking.id));
      assert.ok(!getCleanerBookings("cleaner-001").some((job) => job.id === booking.id));
    });
  });

  describe("AC 2: Open to all cleaners", () => {
    test("without a preferred cleaner the booking is an open request, as before", async () => {
      const date = nextWeekday();
      const res = await postBooking({ date, preferredCleanerId: null });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.assignedCleaner, null);
      assert.equal(data.cleanerUnavailable, false);
      assert.ok(getAvailableBookingRequests().some((job) => job.id === data.booking.id));
    });
  });

  describe("AC 3: the customer sees the assigned cleaner", () => {
    test("the customer's booking shows the cleaner's name and a confirmed badge", async () => {
      const date = nextWeekday();
      const { booking } = await (await postBooking({ date, preferredCleanerId: "cleaner-002" })).json();
      const mine = getCustomerBookings("customer@saiping.com").bookings.find((b) => b.id === booking.id);
      assert.equal(mine.acceptedByName, "Mia Cleaner");
      assert.equal(mine.isAccepted, true);
      assert.equal(mine.badge, "confirmed");
    });
  });

  describe("edge cases: cleaner no longer available", () => {
    test("a suspended cleaner: saved as an open request with the 'no longer available' message", async () => {
      const date = nextWeekday();
      getDatabase().prepare("UPDATE users SET status = 'suspended' WHERE cleaner_id = 'cleaner-002'").run();
      const res = await postBooking({ date, preferredCleanerId: "cleaner-002" });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.assignedCleaner, null);
      assert.equal(data.cleanerUnavailable, true);
      assert.match(data.message, /This cleaner is no longer available/);
      assert.ok(getAvailableBookingRequests().some((job) => job.id === data.booking.id));
    });

    test("a cleaner who stopped working that weekday is not assigned", async () => {
      const date = nextWeekday();
      getDatabase().prepare("UPDATE cleaners SET available_days = '0,6' WHERE id = 'cleaner-002'").run();
      const data = await (await postBooking({ date, preferredCleanerId: "cleaner-002" })).json();
      assert.equal(data.cleanerUnavailable, true);
    });

    test("an unknown cleaner id, or a customer id, is never assigned", async () => {
      const a = await (await postBooking({ date: nextWeekday(), preferredCleanerId: "nobody" })).json();
      assert.equal(a.cleanerUnavailable, true);
      const b = await (await postBooking({ date: nextWeekday(), preferredCleanerId: "user-customer-001" })).json();
      assert.equal(b.cleanerUnavailable, true);
    });

    test("if the slot itself was taken first, nothing is saved and the customer picks another time", async () => {
      const date = nextWeekday();
      createBooking({
        name: "Other",
        email: "other@example.com",
        serviceId: "essential",
        date,
        time: "09:00",
        address: "1 Other Road",
      });
      const res = await postBooking({ date, preferredCleanerId: "cleaner-002" });
      assert.equal(res.status, 409);
      assert.equal(bookingCount(), 1);
    });

    test("booking a cleaner directly needs a signed-in customer", async () => {
      const res = await postBooking({ date: nextWeekday(), preferredCleanerId: "cleaner-002" }, null);
      assert.equal(res.status, 401);
      assert.equal(bookingCount(), 0);
    });
  });

  describe("edge case: double click", () => {
    test("two requests with the same request id create one booking", async () => {
      const date = nextWeekday();
      const body = { date, preferredCleanerId: "cleaner-002", requestId: "double-click-1" };
      const [first, second] = await Promise.all([postBooking(body), postBooking(body)]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 201]);
      const [a, b] = [await first.json(), await second.json()];
      assert.equal(a.booking.id, b.booking.id);
      assert.equal([a, b].filter((r) => r.isDuplicate).length, 1);
      assert.equal(bookingCount(), 1);
      assert.equal((a.isDuplicate ? a : b).assignedCleaner.name, "Mia Cleaner");
    });

    test("the same request id from another customer can't read their booking", async () => {
      const date = nextWeekday();
      await postBooking({ date, requestId: "shared-id" });
      const res = await bookingsPOST(
        new Request("http://localhost/api/bookings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Guest",
            email: "guest@example.com",
            serviceId: "essential",
            address: "5 Guest Road",
            date: nextWeekday(),
            time: "09:00",
            requestId: "shared-id",
          }),
        }),
      );
      assert.equal(res.status, 409);
      assert.equal(bookingCount(), 1);
    });

    test("different request ids are different bookings", async () => {
      const date = nextWeekday();
      await postBooking({ date, time: "09:00", requestId: "r-a" });
      await postBooking({ date, time: "14:00", requestId: "r-b" });
      assert.equal(bookingCount(), 2);
    });
  });
});
