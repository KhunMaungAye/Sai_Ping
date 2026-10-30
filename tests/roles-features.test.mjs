import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createBooking,
  createUserSession,
  getDatabase,
  getDayOfWeekFromDateString,
  getUserByEmail,
  listAvailableSlots,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import { POST as acceptPOST } from "../src/app/api/cleaner/bookings/[id]/accept/route.ts";
import { POST as completePOST } from "../src/app/api/cleaner/bookings/[id]/complete/route.ts";
import { PUT as availabilityPUT } from "../src/app/api/cleaner/availability/route.ts";
import { GET as daysGET } from "../src/app/api/availability/days/route.ts";
import { POST as ratingPOST } from "../src/app/api/bookings/[id]/rating/route.ts";
import { GET as overviewGET } from "../src/app/api/admin/overview/route.ts";

/** Next date (after today) that falls on the given weekday, 0 = Sunday. */
function nextWeekday(weekday) {
  let date = addDaysToDateString(localDateString(), 1);
  while (getDayOfWeekFromDateString(date) !== weekday) {
    date = addDaysToDateString(date, 1);
  }
  return date;
}

function sessionCookie(email) {
  const user = getUserByEmail(email);
  assert.ok(user, `seed user ${email} exists`);
  return `session_token=${createUserSession(user.id).token}`;
}

function call(handler, url, { cookie, method = "POST", body, id } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(`http://localhost${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return id === undefined
    ? handler(request)
    : handler(request, { params: Promise.resolve({ id }) });
}

function book(date, time = "09:00", email = "customer@saiping.com") {
  const result = createBooking({
    name: "Alice Customer",
    email,
    serviceId: "essential",
    date,
    time,
    address: "12 Test Street",
  });
  assert.strictEqual(result.status, "created");
  return result.booking.id;
}

describe("Cleaner availability, job ownership, reviews and admin overview", () => {
  let testDb;

  beforeEach(() => {
    testDb = new DatabaseSync(":memory:");
    resetDatabaseForTesting(testDb);
    getDatabase();
  });

  afterEach(() => {
    resetDatabaseForTesting();
    try {
      testDb.close();
    } catch {}
  });

  test("A job accepted by one cleaner cannot be taken by another", async () => {
    const bookingId = book(nextWeekday(2));
    const first = await call(acceptPOST, `/api/cleaner/bookings/${bookingId}/accept`, {
      cookie: sessionCookie("cleaner@saiping.com"),
      id: bookingId,
    });
    assert.strictEqual(first.status, 200);

    const second = await call(acceptPOST, `/api/cleaner/bookings/${bookingId}/accept`, {
      cookie: sessionCookie("cleaner2@saiping.com"),
      id: bookingId,
    });
    assert.strictEqual(second.status, 409);
    assert.match((await second.json()).error, /another cleaner/i);
  });

  test("Cleaners can only accept jobs on their working days", async () => {
    // Seeded cleaner 2 works Monday–Friday only
    const sundayBooking = book(nextWeekday(0));
    const res = await call(acceptPOST, `/api/cleaner/bookings/${sundayBooking}/accept`, {
      cookie: sessionCookie("cleaner2@saiping.com"),
      id: sundayBooking,
    });
    assert.strictEqual(res.status, 409);
    assert.match((await res.json()).error, /not available on Sundays/);
  });

  test("Customers cannot book a day when no cleaner is working", async () => {
    const sunday = nextWeekday(0);
    assert.ok(listAvailableSlots(sunday).length > 0);

    // Cleaner 1 stops working Sundays; cleaner 2 never works Sundays
    const res = await call(availabilityPUT, "/api/cleaner/availability", {
      method: "PUT",
      cookie: sessionCookie("cleaner@saiping.com"),
      body: { availableDays: [1, 2, 3, 4, 5, 6] },
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual((await res.json()).availableDays, [1, 2, 3, 4, 5, 6]);

    assert.deepStrictEqual(listAvailableSlots(sunday), []);
    const attempt = createBooking({
      name: "Alice Customer",
      email: "customer@saiping.com",
      serviceId: "essential",
      date: sunday,
      time: "09:00",
      address: "12 Test Street",
    });
    assert.strictEqual(attempt.status, "no-cleaner");

    const daysRes = await call(daysGET, "/api/availability/days?count=14", { method: "GET" });
    const { days } = await daysRes.json();
    assert.strictEqual(days.length, 14);
    for (const day of days) {
      if (day.dayName === "Sunday") assert.deepStrictEqual(day.availableSlots, []);
    }
  });

  test("Availability updates are validated and restricted to cleaners", async () => {
    const bad = await call(availabilityPUT, "/api/cleaner/availability", {
      method: "PUT",
      cookie: sessionCookie("cleaner@saiping.com"),
      body: { availableDays: [7] },
    });
    assert.strictEqual(bad.status, 400);

    const customer = await call(availabilityPUT, "/api/cleaner/availability", {
      method: "PUT",
      cookie: sessionCookie("customer@saiping.com"),
      body: { availableDays: [1] },
    });
    assert.strictEqual(customer.status, 403);
  });

  test("Only the cleaner who accepted a job can complete it", async () => {
    const bookingId = book(nextWeekday(3));
    const cleaner1 = sessionCookie("cleaner@saiping.com");
    const cleaner2 = sessionCookie("cleaner2@saiping.com");
    const url = `/api/cleaner/bookings/${bookingId}/complete`;

    const beforeAccept = await call(completePOST, url, { cookie: cleaner1, id: bookingId });
    assert.strictEqual(beforeAccept.status, 409);

    await call(acceptPOST, `/api/cleaner/bookings/${bookingId}/accept`, {
      cookie: cleaner1,
      id: bookingId,
    });

    const wrongCleaner = await call(completePOST, url, { cookie: cleaner2, id: bookingId });
    assert.strictEqual(wrongCleaner.status, 403);

    const owner = await call(completePOST, url, { cookie: cleaner1, id: bookingId });
    assert.strictEqual(owner.status, 200);
  });

  test("Only the booking customer can rate and review a completed cleaning", async () => {
    const bookingId = book(nextWeekday(4));
    const cleaner = sessionCookie("cleaner@saiping.com");
    const owner = sessionCookie("customer@saiping.com");
    const ratingUrl = `/api/bookings/${bookingId}/rating`;

    const early = await call(ratingPOST, ratingUrl, {
      cookie: owner,
      body: { stars: 5 },
      id: bookingId,
    });
    assert.strictEqual(early.status, 409);

    await call(acceptPOST, `/api/cleaner/bookings/${bookingId}/accept`, { cookie: cleaner, id: bookingId });
    await call(completePOST, `/api/cleaner/bookings/${bookingId}/complete`, { cookie: cleaner, id: bookingId });

    const anonymous = await call(ratingPOST, ratingUrl, { body: { stars: 5 }, id: bookingId });
    assert.strictEqual(anonymous.status, 401);

    const cleanerTries = await call(ratingPOST, ratingUrl, {
      cookie: cleaner,
      body: { stars: 5 },
      id: bookingId,
    });
    assert.strictEqual(cleanerTries.status, 403);

    const saved = await call(ratingPOST, ratingUrl, {
      cookie: owner,
      body: { stars: 4, review: "  Spotless kitchen, arrived on time.  " },
      id: bookingId,
    });
    assert.strictEqual(saved.status, 201);
    assert.deepStrictEqual(await saved.json(), {
      stars: 4,
      review: "Spotless kitchen, arrived on time.",
    });

    const again = await call(ratingPOST, ratingUrl, {
      cookie: owner,
      body: { stars: 1 },
      id: bookingId,
    });
    assert.strictEqual(again.status, 409);
  });

  test("Admin overview reports cleaners, customers and reviews", async () => {
    const bookingId = book(nextWeekday(5));
    const cleaner = sessionCookie("cleaner@saiping.com");
    await call(acceptPOST, `/api/cleaner/bookings/${bookingId}/accept`, { cookie: cleaner, id: bookingId });
    await call(completePOST, `/api/cleaner/bookings/${bookingId}/complete`, { cookie: cleaner, id: bookingId });
    await call(ratingPOST, `/api/bookings/${bookingId}/rating`, {
      cookie: sessionCookie("customer@saiping.com"),
      body: { stars: 5, review: "Great job" },
      id: bookingId,
    });

    const denied = await call(overviewGET, "/api/admin/overview", {
      method: "GET",
      cookie: sessionCookie("customer@saiping.com"),
    });
    assert.strictEqual(denied.status, 403);

    const res = await call(overviewGET, "/api/admin/overview", {
      method: "GET",
      cookie: sessionCookie("admin@saiping.com"),
    });
    assert.strictEqual(res.status, 200);
    const { cleaners, customers, reviews } = await res.json();

    const c1 = cleaners.find((c) => c.email === "cleaner@saiping.com");
    assert.strictEqual(c1.completedJobs, 1);
    assert.strictEqual(c1.averageRating, 5);
    assert.strictEqual(c1.reviewCount, 1);
    assert.deepStrictEqual(
      cleaners.find((c) => c.email === "cleaner2@saiping.com").availableDays,
      [1, 2, 3, 4, 5],
    );

    const alice = customers.find((c) => c.email === "customer@saiping.com");
    assert.strictEqual(alice.totalBookings, 1);
    assert.strictEqual(alice.completedBookings, 1);
    assert.strictEqual(alice.reviewsWritten, 1);

    assert.strictEqual(reviews.length, 1);
    assert.strictEqual(reviews[0].review, "Great job");
    assert.strictEqual(reviews[0].cleanerName, "Sai Ping Cleaner");
  });
});
