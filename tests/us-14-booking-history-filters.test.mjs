import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { addDaysToDateString, bangkokDateString } from "../src/lib/date-utils.ts";
import { BOOKING_BADGE_LABELS, bookingBadge } from "../src/lib/booking-badges.ts";
import {
  acceptBookingRequest,
  cancelCustomerBooking,
  createBooking,
  createUser,
  createUserSession,
  getAvailableBookingRequests,
  getCustomerBookings,
  getDatabase,
  getUserByEmail,
  markBookingCompleted,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import { GET as bookingsGET } from "../src/app/api/bookings/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const CUSTOMER = "customer@saiping.com";
const today = () => bangkokDateString();
const day = (offset) => addDaysToDateString(today(), offset);

/**
 * Books a cleaning. `date` may be in the past: the booking is created on a
 * future date and moved, because the booking form only allows future dates.
 */
let placeholderDay = 30;

function book({ date, time = "09:00", email = CUSTOMER, accepted = false, completed = false }) {
  placeholderDay += 1;
  const placeholder = addDaysToDateString(today(), placeholderDay);
  const result = createBooking({
    name: "Alice Customer",
    email,
    serviceId: "essential",
    date: placeholder,
    time,
    address: "1 Test Road",
  });
  assert.equal(result.status, "created", JSON.stringify(result));
  const { id } = result.booking;
  getDatabase().prepare("UPDATE bookings SET service_date = ? WHERE id = ?").run(date, id);
  if (accepted || completed) {
    const cleaner = getUserByEmail("cleaner@saiping.com");
    getDatabase()
      .prepare("UPDATE bookings SET accepted_by_id = ?, accepted_by_name = ? WHERE id = ?")
      .run(cleaner.cleanerId, cleaner.name, id);
  }
  if (completed) markBookingCompleted(id, "cleaner-001");
  return id;
}

async function history(email = CUSTOMER) {
  const user = getUserByEmail(email);
  const token = createUserSession(user.id).token;
  const res = await bookingsGET(
    new Request("http://localhost/api/bookings", { headers: { cookie: `session_token=${token}` } }),
  );
  assert.equal(res.status, 200);
  return res.json();
}

describe("US-14: booking history status filters", () => {
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

  test("AC1: bookings split into Upcoming and Past/Completed by date and status", async () => {
    const future = book({ date: day(5) });
    const todayJob = book({ date: today(), time: "14:00", accepted: true });
    const pastDone = book({ date: day(-3), completed: true });
    const pastMissed = book({ date: day(-2), accepted: true });
    const futureDone = book({ date: day(2), completed: true }); // completed early

    const data = await history();
    assert.deepEqual(new Set(data.upcoming.map((b) => b.id)), new Set([future, todayJob]));
    assert.deepEqual(new Set(data.previous.map((b) => b.id)), new Set([pastDone, pastMissed, futureDone]));
  });

  test("AC2: Upcoming is soonest first; Past is most recent first, by date then time", async () => {
    const u2 = book({ date: day(4), time: "14:00" });
    const u1 = book({ date: day(4), time: "09:00" });
    const u3 = book({ date: day(9) });
    const p2 = book({ date: day(-6), completed: true });
    const p1 = book({ date: day(-1), time: "14:00", completed: true });
    const p0 = book({ date: day(-1), time: "09:00", accepted: true });

    const data = await history();
    assert.deepEqual(data.upcoming.map((b) => b.id), [u1, u2, u3]);
    assert.deepEqual(data.previous.map((b) => b.id), [p1, p0, p2]);
  });

  test("AC2: each booking carries a status badge that matches what happened", async () => {
    const ids = {
      confirmed: book({ date: day(3), accepted: true }),
      "awaiting-cleaner": book({ date: day(4) }),
      completed: book({ date: day(-3), completed: true }),
      "not-completed": book({ date: day(-2), accepted: true }),
      "no-cleaner": book({ date: day(-1) }),
    };
    const data = await history();
    const byId = Object.fromEntries(data.bookings.map((b) => [b.id, b]));
    for (const [badge, id] of Object.entries(ids)) {
      assert.equal(byId[id].badge, badge, `booking ${badge}`);
    }
    assert.equal(BOOKING_BADGE_LABELS["not-completed"], "Not completed");
    assert.equal(BOOKING_BADGE_LABELS["no-cleaner"], "No cleaner assigned");
  });

  test("badge rule covers every combination", () => {
    assert.equal(bookingBadge("completed", false, true), "completed");
    assert.equal(bookingBadge("completed", true, false), "completed");
    assert.equal(bookingBadge("scheduled", true, true), "confirmed");
    assert.equal(bookingBadge("scheduled", false, true), "awaiting-cleaner");
    assert.equal(bookingBadge("scheduled", true, false), "not-completed");
    assert.equal(bookingBadge("scheduled", false, false), "no-cleaner");
  });

  test("cancelled bookings are listed latest visit first, like past bookings", async () => {
    const later = book({ date: day(20) });
    const sooner = book({ date: day(10) });
    // Cancel the later visit first: order must follow the visit date, not the cancel time.
    assert.equal(cancelCustomerBooking(later, CUSTOMER).status, "cancelled");
    assert.equal(cancelCustomerBooking(sooner, CUSTOMER).status, "cancelled");
    const data = await history();
    assert.deepEqual(data.cancelled.map((b) => b.id), [later, sooner]);
  });

  test("empty lists for a customer with no bookings", async () => {
    const data = await history();
    assert.deepEqual(data.upcoming, []);
    assert.deepEqual(data.previous, []);
    assert.deepEqual(data.cancelled, []);
  });

  test("only the signed-in customer's bookings appear in either tab", async () => {
    createUser({ email: "other@example.com", passwordHash: "x", name: "Other", role: "customer" });
    const mine = book({ date: day(3) });
    book({ date: day(4), email: "other@example.com" });
    book({ date: day(-4), email: "other@example.com", completed: true });

    const data = await history();
    assert.deepEqual(data.upcoming.map((b) => b.id), [mine]);
    assert.deepEqual(data.previous, []);
  });

  test("'today' is the Bangkok date, even when the server's date is different", () => {
    // 20:00 UTC on day D is already 03:00 on day D+1 in Bangkok. D is in the
    // future, so a check that used the real clock or the server's own date
    // would wrongly keep this booking under Upcoming.
    const d = day(10);
    const now = new Date(`${d}T20:00:00Z`);
    const id = book({ date: d });
    const previousTz = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const result = getCustomerBookings(CUSTOMER, now);
      assert.deepEqual(result.upcoming, []);
      assert.equal(result.previous[0].id, id);
      assert.equal(result.previous[0].badge, "no-cleaner");
      // One hour earlier it's still day D in Bangkok (02:00): upcoming.
      const earlier = getCustomerBookings(CUSTOMER, new Date(`${d}T16:00:00Z`));
      assert.equal(earlier.upcoming[0].id, id);
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  test("bookings and cancellations are read in one transaction that is always closed", () => {
    book({ date: day(3) });
    getCustomerBookings(CUSTOMER);
    getDatabase().exec("BEGIN IMMEDIATE; COMMIT;"); // the read transaction was committed

    getDatabase().exec("DROP TABLE cancelled_bookings;");
    assert.throws(() => getCustomerBookings(CUSTOMER));
    getDatabase().exec("BEGIN IMMEDIATE; COMMIT;"); // ...and rolled back on failure
  });

  test("cleaners can't see or accept a request whose Bangkok date has passed", () => {
    const yesterday = book({ date: day(-1) });
    const tomorrow = book({ date: day(1) });
    const open = getAvailableBookingRequests().map((b) => b.id);
    assert.ok(open.includes(tomorrow));
    assert.ok(!open.includes(yesterday));

    const cleaner = getUserByEmail("cleaner@saiping.com");
    const result = acceptBookingRequest(yesterday, cleaner.cleanerId, cleaner.name);
    assert.equal(result.success, false);
    assert.match(result.error, /already passed/);
    assert.equal(acceptBookingRequest(tomorrow, cleaner.cleanerId, cleaner.name).success, true);
  });

  test("401 when signed out", async () => {
    const res = await bookingsGET(new Request("http://localhost/api/bookings"));
    assert.equal(res.status, 401);
  });
});
