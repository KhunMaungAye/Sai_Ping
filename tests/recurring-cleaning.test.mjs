import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  generateRecurringDates,
  getDayNameFromDateString,
  getDayOfWeekFromDateString,
  getNextServiceDate,
  isBookableDate,
  localDateString,
} from "../src/lib/date-utils.ts";
import {
  createRecurringSubscription,
  createBooking,
  getSubscription,
  resetDatabaseForTesting,
  getDatabase,
} from "../src/lib/booking-store.ts";
import {
  POST as handleSubscriptionPOST,
  GET as handleSubscriptionGET,
} from "../src/app/api/subscriptions/route.ts";
import { POST as handleBookingPOST } from "../src/app/api/bookings/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

describe("US-03: Set Up Recurring Cleaning", () => {
  let testDb;

  beforeEach(() => {
    testDb = new DatabaseSync(":memory:");
    resetDatabaseForTesting(testDb);
    seedTestUsers();
    getDatabase(); // initialize schema on testDb
  });

  afterEach(() => {
    resetDatabaseForTesting();
    try {
      testDb.close();
    } catch {}
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Weekly recurring subscription setup
  // --------------------------------------------------------------------------
  test("Scenario 1: Successfully sets up weekly recurring subscription with 4 scheduled bookings", async () => {
    const today = new Date();
    today.setDate(today.getDate() + 2);
    const startDate = localDateString(today);
    const preferredDay = getDayNameFromDateString(startDate);

    const input = {
      name: "Alice Johnson",
      email: "alice@example.com",
      address: "123 Maple Street, Springfield",
      serviceId: "essential",
      frequency: "weekly",
      preferredDay,
      startDate,
      time: "09:00",
    };

    const result = createRecurringSubscription(input);
    assert.strictEqual(result.status, "created");
    assert.ok(result.subscription);
    assert.strictEqual(result.subscription.frequency, "weekly");
    assert.strictEqual(result.subscription.name, "Alice Johnson");
    assert.strictEqual(result.bookings.length, 4);

    // Verify 7-day intervals
    for (let i = 0; i < result.bookings.length; i++) {
      const expectedDate = addDaysToDateString(startDate, i * 7);
      assert.strictEqual(result.bookings[i].date, expectedDate);
      assert.strictEqual(result.bookings[i].time, "09:00");
      assert.strictEqual(result.bookings[i].subscriptionId, result.subscription.id);
    }

    // Verify persistence in SQLite
    const saved = getSubscription(result.subscription.id);
    assert.ok(saved);
    assert.strictEqual(saved.subscription.id, result.subscription.id);
    assert.strictEqual(saved.bookings.length, 4);
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Biweekly recurring subscription setup
  // --------------------------------------------------------------------------
  test("Scenario 2: Successfully sets up biweekly recurring subscription with 14-day intervals", async () => {
    const today = new Date();
    today.setDate(today.getDate() + 3);
    const startDate = localDateString(today);
    const preferredDay = getDayNameFromDateString(startDate);

    const input = {
      name: "Bob Martin",
      email: "bob@example.com",
      address: "456 Oak Avenue, Metropolis",
      serviceId: "deep",
      frequency: "biweekly",
      preferredDay,
      startDate,
      time: "14:00",
      occurrences: 4,
    };

    const result = createRecurringSubscription(input);
    assert.strictEqual(result.status, "created");
    assert.strictEqual(result.subscription.frequency, "biweekly");
    assert.strictEqual(result.bookings.length, 4);

    // Verify 14-day intervals
    for (let i = 0; i < result.bookings.length; i++) {
      const expectedDate = addDaysToDateString(startDate, i * 14);
      assert.strictEqual(result.bookings[i].date, expectedDate);
      assert.strictEqual(result.bookings[i].time, "14:00");
    }

    // Verify database bookings have subscription_id foreign key
    const bookingRows = testDb
      .prepare("SELECT * FROM bookings WHERE subscription_id = ?")
      .all(result.subscription.id);
    assert.strictEqual(bookingRows.length, 4);
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Preferred day and start date selection & alignment
  // --------------------------------------------------------------------------
  test("Scenario 3: Preferred day selection accurately calculates next matching service date", () => {
    // 2026-10-19 is a Monday (UTCDay = 1)
    const monday = "2026-10-19";
    assert.strictEqual(getDayOfWeekFromDateString(monday), 1);
    assert.strictEqual(getDayNameFromDateString(monday), "Monday");

    // Picking Wednesday (index 3) from Monday (index 1) adds 2 days -> 2026-10-21
    const nextWednesday = getNextServiceDate(monday, "Wednesday");
    assert.strictEqual(nextWednesday, "2026-10-21");
    assert.strictEqual(getDayNameFromDateString(nextWednesday), "Wednesday");

    // Picking Monday when startDate is already Monday adds 0 days -> same date
    const sameMonday = getNextServiceDate(monday, "Monday");
    assert.strictEqual(sameMonday, "2026-10-19");

    // Picking Sunday (index 0) from Monday (index 1) adds 6 days -> 2026-10-25
    const nextSunday = getNextServiceDate(monday, "Sunday");
    assert.strictEqual(nextSunday, "2026-10-25");
    assert.strictEqual(getDayNameFromDateString(nextSunday), "Sunday");
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Display next scheduled service date before confirmation
  // --------------------------------------------------------------------------
  test("Scenario 4: Preview endpoint and store calculate and return next scheduled service date", async () => {
    const today = new Date();
    today.setDate(today.getDate() + 2);
    const startDate = localDateString(today);
    const dayName = getDayNameFromDateString(startDate);

    const req = new Request(
      `http://localhost/api/subscriptions?startDate=${startDate}&frequency=weekly&time=09:00&preferredDay=${dayName}`,
    );
    const res = await handleSubscriptionGET(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.available, true);
    assert.strictEqual(data.nextServiceDate, startDate);
    assert.ok(Array.isArray(data.dates));
    assert.strictEqual(data.dates.length, 4);
    assert.strictEqual(data.dates[0], startDate);
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Edge Case 1 - Atomic conflict handling (Cleaner unavailable on recurring date)
  // --------------------------------------------------------------------------
  test("Scenario 5 (Edge Case 1): Rejects atomically with conflict date when cleaner is unavailable on any recurring date", async () => {
    const today = new Date();
    today.setDate(today.getDate() + 5);
    const startDate = localDateString(today);
    const conflictDate = addDaysToDateString(startDate, 14); // 3rd recurrence

    // Pre-book the slot on the 3rd recurrence
    createBooking({
      name: "Existing Customer",
      email: "existing@example.com",
      address: "789 Pine Road",
      serviceId: "essential",
      date: conflictDate,
      time: "09:00",
    });

    const subInput = {
      name: "Charlie Brown",
      email: "charlie@example.com",
      address: "101 Elm Street",
      serviceId: "essential",
      frequency: "weekly",
      startDate,
      time: "09:00",
    };

    // Attempt to book subscription
    const result = createRecurringSubscription(subInput);
    assert.strictEqual(result.status, "conflict");
    assert.strictEqual(result.conflictDate, conflictDate);
    assert.ok(result.error.includes(conflictDate));

    // Verify zero partial bookings were inserted in SQLite (atomic rollback)
    const bookingsForCharlie = testDb
      .prepare("SELECT * FROM bookings WHERE email = ?")
      .all("charlie@example.com");
    assert.strictEqual(bookingsForCharlie.length, 0);

    const subscriptionsForCharlie = testDb
      .prepare("SELECT * FROM subscriptions WHERE email = ?")
      .all("charlie@example.com");
    assert.strictEqual(subscriptionsForCharlie.length, 0);

    // Verify API returns 409 Conflict with conflictDate
    const apiReq = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subInput),
    });
    const apiRes = await handleSubscriptionPOST(apiReq);
    assert.strictEqual(apiRes.status, 409);
    const apiData = await apiRes.json();
    assert.strictEqual(apiData.code, "RECURRING_SLOT_UNAVAILABLE");
    assert.strictEqual(apiData.conflictDate, conflictDate);
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Edge Case 2 - Past start date rejection
  // --------------------------------------------------------------------------
  test("Scenario 6 (Edge Case 2): Rejects past start date on server with 400 Bad Request", async () => {
    const pastDate = "2020-01-01";
    assert.strictEqual(isBookableDate(pastDate), false);

    const subInput = {
      name: "Dave Miller",
      email: "dave@example.com",
      address: "202 Birch Way",
      serviceId: "essential",
      frequency: "weekly",
      startDate: pastDate,
      time: "09:00",
    };

    const req = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subInput),
    });
    const res = await handleSubscriptionPOST(req);
    assert.strictEqual(res.status, 400);

    const data = await res.json();
    assert.ok(data.error.toLowerCase().includes("past"));
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Edge Case 2 - Invalid start date format rejection
  // --------------------------------------------------------------------------
  test("Scenario 7 (Edge Case 2): Rejects invalid or non-existent calendar date formats", async () => {
    // Malformed format
    const req1 = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Eve Adams",
        email: "eve@example.com",
        address: "303 Cedar Blvd",
        serviceId: "essential",
        frequency: "weekly",
        startDate: "not-a-date",
        time: "09:00",
      }),
    });
    const res1 = await handleSubscriptionPOST(req1);
    assert.strictEqual(res1.status, 400);

    // Non-existent calendar date (e.g. Feb 31)
    const req2 = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Eve Adams",
        email: "eve@example.com",
        address: "303 Cedar Blvd",
        serviceId: "essential",
        frequency: "weekly",
        startDate: "2028-02-31",
        time: "09:00",
      }),
    });
    const res2 = await handleSubscriptionPOST(req2);
    assert.strictEqual(res2.status, 400);
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Edge Case 3 - End date earlier than start date rejection & bounds
  // --------------------------------------------------------------------------
  test("Scenario 8 (Edge Case 3): Rejects end date earlier than start date and properly bounds schedule", async () => {
    const today = new Date();
    today.setDate(today.getDate() + 10);
    const startDate = localDateString(today);
    const earlierEndDate = addDaysToDateString(startDate, -3);

    // Reject earlier end date
    const req1 = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Frank Castle",
        email: "frank@example.com",
        address: "404 Willow Lane",
        serviceId: "essential",
        frequency: "weekly",
        startDate,
        endDate: earlierEndDate,
        time: "09:00",
      }),
    });
    const res1 = await handleSubscriptionPOST(req1);
    assert.strictEqual(res1.status, 400);
    const data1 = await res1.json();
    assert.strictEqual(data1.code, "INVALID_END_DATE");

    // Valid end date bounds the schedule to exactly 2 visits
    const validEndDate = addDaysToDateString(startDate, 10); // 7 days fit 2 visits (day 0 and day 7)
    const req2 = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Frank Castle",
        email: "frank@example.com",
        address: "404 Willow Lane",
        serviceId: "essential",
        frequency: "weekly",
        startDate,
        endDate: validEndDate,
        time: "09:00",
      }),
    });
    const res2 = await handleSubscriptionPOST(req2);
    assert.strictEqual(res2.status, 201);
    const data2 = await res2.json();
    assert.strictEqual(data2.bookings.length, 2);
    assert.strictEqual(data2.bookings[0].date, startDate);
    assert.strictEqual(data2.bookings[1].date, addDaysToDateString(startDate, 7));
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Edge Case 4 - Duplicate submission prevention (idempotency safeguards)
  // --------------------------------------------------------------------------
  test("Scenario 9 (Edge Case 4): Idempotency key prevents duplicate subscription and booking creation", async () => {
    const today = new Date();
    today.setDate(today.getDate() + 4);
    const startDate = localDateString(today);
    const idempotencyKey = "unique-key-123456";

    const payload = {
      name: "Grace Hopper",
      email: "grace@example.com",
      address: "505 Binary Drive",
      serviceId: "essential",
      frequency: "weekly",
      startDate,
      time: "14:00",
      idempotencyKey,
    };

    // First submission
    const res1 = await handleSubscriptionPOST(
      new Request("http://localhost/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    assert.strictEqual(res1.status, 201);
    const data1 = await res1.json();
    const originalSubId = data1.subscription.id;

    // Second submission with identical idempotencyKey
    const res2 = await handleSubscriptionPOST(
      new Request("http://localhost/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.strictEqual(data2.isDuplicate, true);
    assert.strictEqual(data2.subscription.id, originalSubId);

    // Verify database only has 1 subscription and 4 bookings total
    const subs = testDb
      .prepare("SELECT * FROM subscriptions WHERE email = ?")
      .all("grace@example.com");
    assert.strictEqual(subs.length, 1);

    const bookings = testDb
      .prepare("SELECT * FROM bookings WHERE email = ?")
      .all("grace@example.com");
    assert.strictEqual(bookings.length, 4);
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Edge Case 5 - Boundary date arithmetic without timezone shifts
  // --------------------------------------------------------------------------
  test("Scenario 10 (Edge Case 5): Weekly and biweekly date arithmetic crosses month and year boundaries with zero timezone shift", () => {
    // 1. Month boundary: January to February
    assert.strictEqual(addDaysToDateString("2026-01-25", 7), "2026-02-01");
    assert.strictEqual(addDaysToDateString("2026-01-31", 7), "2026-02-07");
    assert.strictEqual(addDaysToDateString("2026-01-20", 14), "2026-02-03");

    // 2. Leap year handling: 2028 is a leap year (29 days in Feb), 2027 is non-leap (28 days)
    assert.strictEqual(addDaysToDateString("2028-02-28", 1), "2028-02-29");
    assert.strictEqual(addDaysToDateString("2028-02-28", 2), "2028-03-01");
    assert.strictEqual(addDaysToDateString("2027-02-28", 1), "2027-03-01");

    // 3. Year boundary: December to January
    assert.strictEqual(addDaysToDateString("2026-12-25", 7), "2027-01-01");
    assert.strictEqual(addDaysToDateString("2026-12-28", 7), "2027-01-04");
    assert.strictEqual(addDaysToDateString("2026-12-23", 14), "2027-01-06");
    assert.strictEqual(addDaysToDateString("2026-12-30", 14), "2027-01-13");

    // 4. Multi-month series crossing year boundary
    const recurring = generateRecurringDates({
      startDate: "2026-12-15",
      frequency: "weekly",
      occurrences: 5,
    });
    assert.deepStrictEqual(recurring, [
      "2026-12-15",
      "2026-12-22",
      "2026-12-29",
      "2027-01-05",
      "2027-01-12",
    ]);

    // 5. Verify biweekly crossing year boundary
    const biweeklyRecurring = generateRecurringDates({
      startDate: "2026-12-16",
      frequency: "biweekly",
      occurrences: 3,
    });
    assert.deepStrictEqual(biweeklyRecurring, [
      "2026-12-16",
      "2026-12-30",
      "2027-01-13",
    ]);
  });

  test("Bonus: /api/bookings endpoint also supports recurring subscriptions when frequency is provided", async () => {
    const today = new Date();
    today.setDate(today.getDate() + 7);
    const startDate = localDateString(today);

    const req = new Request("http://localhost/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Hannah Montana",
        email: "hannah@example.com",
        address: "777 Sunset Strip",
        serviceId: "move-out",
        frequency: "weekly",
        startDate,
        time: "09:00",
      }),
    });
    const res = await handleBookingPOST(req);
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.subscription);
    assert.strictEqual(data.subscription.frequency, "weekly");
    assert.strictEqual(data.bookings.length, 4);
  });
});

