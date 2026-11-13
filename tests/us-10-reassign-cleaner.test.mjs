import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  acceptBookingRequest,
  addDaysToDateString,
  createBooking,
  createUserSession,
  getAllBookingsAdmin,
  getCleanerBookings,
  getDatabase,
  getDayOfWeekFromDateString,
  getUserByEmail,
  localDateString,
  markBookingCompleted,
  resetDatabaseForTesting,
  updateUserStatus,
} from "../src/lib/booking-store.ts";
import {
  GET as optionsGET,
  POST as reassignPOST,
} from "../src/app/api/admin/bookings/[id]/reassign/route.ts";
import { GET as adminBookingsGET } from "../src/app/api/admin/bookings/route.ts";
import { GET as cleanerJobGET } from "../src/app/api/cleaner/bookings/[id]/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const ADMIN = "admin@saiping.com";
const CLEANER = "cleaner@saiping.com"; // Sai Ping Cleaner, works every day
const CLEANER2 = "cleaner2@saiping.com"; // Mia Cleaner, works Monday–Friday

function nextDay(weekdays) {
  let date = addDaysToDateString(localDateString(), 1);
  while (!weekdays.includes(getDayOfWeekFromDateString(date))) date = addDaysToDateString(date, 1);
  return date;
}
const nextWeekday = () => nextDay([1, 2, 3, 4, 5]);
const nextSaturday = () => nextDay([6]);

function cookieFor(email) {
  return `session_token=${createUserSession(getUserByEmail(email).id).token}`;
}

function cleanerIdOf(email) {
  const user = getUserByEmail(email);
  return user.cleanerId || user.id;
}

function book(date = nextWeekday()) {
  const result = createBooking({
    name: "Alice Customer",
    email: "customer@saiping.com",
    serviceId: "deep",
    date,
    time: "09:00",
    address: "12 Sukhumvit Soi 24, Bangkok",
    specialInstructions: "Door code 1234",
  });
  assert.strictEqual(result.status, "created");
  return result.booking;
}

function accept(bookingId, email = CLEANER) {
  const user = getUserByEmail(email);
  assert.strictEqual(acceptBookingRequest(bookingId, cleanerIdOf(email), user.name).success, true);
}

function reassign(id, body, email = ADMIN) {
  const headers = { "content-type": "application/json" };
  if (email) headers.cookie = cookieFor(email);
  return reassignPOST(
    new Request(`http://localhost/api/admin/bookings/${id}/reassign`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function options(id, email = ADMIN) {
  const headers = email ? { cookie: cookieFor(email) } : {};
  return optionsGET(new Request(`http://localhost/api/admin/bookings/${id}/reassign`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

const adminRow = (id) => getAllBookingsAdmin().find((b) => b.id === id);

describe("US-10 manage cleaner assignments", () => {
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

  // ---- AC1: reassign to another available cleaner ---------------------------

  test("AC1: the admin can reassign a booking to another available cleaner", async () => {
    const booking = book();
    accept(booking.id, CLEANER);
    const res = await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.cleanerName, "Mia Cleaner");
    assert.strictEqual(data.previousCleanerName, "Sai Ping Cleaner");
    assert.match(data.message, /^Booking reassigned from Sai Ping Cleaner to Mia Cleaner\./);
  });

  test("AC1: the admin only sees available cleaners: active, working that day, not the current one", async () => {
    const weekday = book();
    accept(weekday.id, CLEANER);
    const weekdayOptions = await (await options(weekday.id)).json();
    assert.deepStrictEqual(weekdayOptions.cleaners.map((c) => c.name), ["Mia Cleaner"]);
    assert.strictEqual(weekdayOptions.booking.currentCleanerName, "Sai Ping Cleaner");

    // Mia doesn't work Saturdays, and Sai Ping Cleaner already has the job.
    const saturday = book(nextSaturday());
    accept(saturday.id, CLEANER);
    assert.deepStrictEqual((await (await options(saturday.id)).json()).cleaners, []);

    // A suspended cleaner is not offered.
    updateUserStatus(getUserByEmail(CLEANER2).id, "suspended");
    assert.deepStrictEqual((await (await options(weekday.id)).json()).cleaners, []);
  });

  test("AC1: an open request nobody accepted yet can be assigned to a cleaner", async () => {
    const booking = book();
    const res = await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.previousCleanerName, null);
    assert.match(data.message, /^Booking assigned to Mia Cleaner\./);
  });

  // ---- AC2: the job moves to the new cleaner automatically -------------------

  test("AC2: the job moves to the new cleaner's schedule and leaves the old cleaner's", async () => {
    const booking = book();
    accept(booking.id, CLEANER);
    await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) });
    assert.ok(getCleanerBookings(cleanerIdOf(CLEANER2)).some((b) => b.id === booking.id));
    assert.ok(!getCleanerBookings(cleanerIdOf(CLEANER)).some((b) => b.id === booking.id));
  });

  test("AC2: the new cleaner gets the job details, the old cleaner no longer does", async () => {
    const booking = book();
    accept(booking.id, CLEANER);
    await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) });
    const job = (email) =>
      cleanerJobGET(
        new Request(`http://localhost/api/cleaner/bookings/${booking.id}`, {
          headers: { cookie: cookieFor(email) },
        }),
        { params: Promise.resolve({ id: booking.id }) },
      );
    const res = await job(CLEANER2);
    assert.strictEqual(res.status, 200);
    const details = await res.json();
    assert.strictEqual(details.job.address, "12 Sukhumvit Soi 24, Bangkok");
    assert.strictEqual(details.job.specialInstructions, "Door code 1234");
    assert.strictEqual((await job(CLEANER)).status, 404);
  });

  test("AC2: an open no-show alert for the job is resolved as reassigned", async () => {
    const booking = book();
    accept(booking.id, CLEANER);
    getDatabase()
      .prepare(
        `INSERT INTO no_show_alerts (id, booking_id, cleaner_id, cleaner_name, expected_by, detected_at)
         VALUES ('alert-1', ?, ?, 'Sai Ping Cleaner', ?, ?)`,
      )
      .run(booking.id, cleanerIdOf(CLEANER), new Date().toISOString(), new Date().toISOString());
    await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) });
    const alert = getDatabase().prepare("SELECT * FROM no_show_alerts WHERE id = 'alert-1'").get();
    assert.strictEqual(alert.status, "resolved");
    assert.strictEqual(alert.resolution, "reassigned");
    assert.strictEqual(alert.reassigned_to_name, "Mia Cleaner");
  });

  // ---- AC3: the booking shows the new cleaner ---------------------------------

  test("AC3: after reassignment the booking shows the new cleaner as assigned", async () => {
    const booking = book();
    accept(booking.id, CLEANER);
    await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) });
    assert.strictEqual(adminRow(booking.id).acceptedByName, "Mia Cleaner");

    const res = await adminBookingsGET(
      new Request("http://localhost/api/admin/bookings", { headers: { cookie: cookieFor(ADMIN) } }),
    );
    const { bookings } = await res.json();
    assert.strictEqual(bookings.find((b) => b.id === booking.id).acceptedByName, "Mia Cleaner");
  });

  // ---- Edge cases -------------------------------------------------------------

  test("Edge: choosing the cleaner who already has the job is refused", async () => {
    const booking = book();
    accept(booking.id, CLEANER);
    const res = await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(adminRow(booking.id).acceptedByName, "Sai Ping Cleaner");
  });

  test("Edge: a cleaner who doesn't work that day is refused", async () => {
    const booking = book(nextSaturday());
    const res = await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /works on that day/);
  });

  test("Edge: a suspended cleaner is refused", async () => {
    const booking = book();
    updateUserStatus(getUserByEmail(CLEANER2).id, "suspended");
    assert.strictEqual((await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) })).status, 400);
  });

  test("Edge: an unknown cleaner or a missing cleaner id is refused", async () => {
    const booking = book();
    assert.strictEqual((await reassign(booking.id, { cleanerId: "nobody" })).status, 400);
    const missing = await reassign(booking.id, {});
    assert.strictEqual(missing.status, 400);
    assert.match((await missing.json()).error, /Choose a cleaner/);
  });

  test("Edge: a completed booking can't be reassigned", async () => {
    const booking = book();
    accept(booking.id, CLEANER);
    markBookingCompleted(booking.id, cleanerIdOf(CLEANER), { requireAcceptedBy: cleanerIdOf(CLEANER) });
    const res = await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) });
    assert.strictEqual(res.status, 409);
    assert.match((await res.json()).error, /already completed/);
    assert.strictEqual((await options(booking.id)).status, 409);
  });

  test("Edge: a booking whose date has passed can't be reassigned", async () => {
    const booking = book();
    getDatabase()
      .prepare("UPDATE bookings SET service_date = ? WHERE id = ?")
      .run(addDaysToDateString(localDateString(), -7), booking.id);
    const res = await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) });
    assert.strictEqual(res.status, 409);
    assert.match((await res.json()).error, /date has passed/);
  });

  test("Edge: an unknown booking is not found", async () => {
    assert.strictEqual((await reassign("no-such-booking", { cleanerId: cleanerIdOf(CLEANER2) })).status, 404);
    assert.strictEqual((await options("no-such-booking")).status, 404);
  });

  // ---- Access rules -------------------------------------------------------------

  test("Access: signed out gets 401", async () => {
    const booking = book();
    assert.strictEqual((await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) }, null)).status, 401);
    assert.strictEqual((await options(booking.id, null)).status, 401);
  });

  test("Access: customers and cleaners get 403 and nothing changes", async () => {
    const booking = book();
    accept(booking.id, CLEANER);
    for (const email of ["customer@saiping.com", CLEANER, CLEANER2]) {
      assert.strictEqual((await reassign(booking.id, { cleanerId: cleanerIdOf(CLEANER2) }, email)).status, 403, email);
      assert.strictEqual((await options(booking.id, email)).status, 403, email);
    }
    assert.strictEqual(adminRow(booking.id).acceptedByName, "Sai Ping Cleaner");
  });
});
