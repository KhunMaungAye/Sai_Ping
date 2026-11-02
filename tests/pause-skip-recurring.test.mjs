import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createBooking,
  createRecurringSubscription,
  createUserSession,
  getCustomerBookings,
  getDatabase,
  getDayNameFromDateString,
  getDayOfWeekFromDateString,
  getUserByEmail,
  listAvailableSlots,
  listCustomerSubscriptions,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import { GET as plansGET } from "../src/app/api/customer/subscriptions/route.ts";
import { POST as skipPOST } from "../src/app/api/subscriptions/[id]/skip/route.ts";
import { POST as pausePOST } from "../src/app/api/subscriptions/[id]/pause/route.ts";
import { POST as resumePOST } from "../src/app/api/subscriptions/[id]/resume/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const CUSTOMER = "customer@saiping.com";

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

function makePlan({ frequency = "weekly", weekday = 2, occurrences = 4, time = "09:00" } = {}) {
  const startDate = nextWeekday(weekday);
  const result = createRecurringSubscription({
    name: "Alice Customer",
    email: CUSTOMER,
    serviceId: "essential",
    address: "12 Sukhumvit Soi 24, Bangkok",
    frequency,
    preferredDay: getDayNameFromDateString(startDate),
    startDate,
    occurrences,
    time,
  });
  assert.strictEqual(result.status, "created");
  return { id: result.subscription.id, dates: result.bookings.map((b) => b.date) };
}

function call(handler, id, body, email = CUSTOMER) {
  const headers = { "content-type": "application/json" };
  if (email) headers.cookie = cookieFor(email);
  return handler(
    new Request(`http://localhost/api/subscriptions/${id}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const visitDates = () =>
  getCustomerBookings(CUSTOMER).bookings.map((b) => b.date).sort();
const plan = (id) => listCustomerSubscriptions(CUSTOMER).find((p) => p.id === id);

describe("US-15 pause and skip recurring cleanings", () => {
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

  test("Customers can list their own plans with the next visit", async () => {
    const { id, dates } = makePlan();
    const res = await plansGET(
      new Request("http://localhost/api/customer/subscriptions", {
        headers: { cookie: cookieFor(CUSTOMER) },
      }),
    );
    assert.strictEqual(res.status, 200);
    const { subscriptions } = await res.json();
    assert.strictEqual(subscriptions.length, 1);
    assert.strictEqual(subscriptions[0].id, id);
    assert.strictEqual(subscriptions[0].status, "active");
    assert.strictEqual(subscriptions[0].nextVisit.date, dates[0]);
    assert.deepStrictEqual(subscriptions[0].upcomingVisits, dates);
  });

  test("Skip next date removes only that weekly visit and keeps the plan", async () => {
    const { id, dates } = makePlan({ frequency: "weekly" });
    const res = await call(skipPOST, id, { date: dates[0] });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.match(data.message, /Skipped your .* visit\. You won't be charged/);
    assert.strictEqual(data.subscription.status, "active");
    assert.strictEqual(data.subscription.nextVisit.date, dates[1]);
    assert.deepStrictEqual(visitDates(), dates.slice(1));
    // The freed slot can be booked by someone else
    assert.ok(listAvailableSlots(dates[0]).includes("09:00"));
  });

  test("A duplicate skip request does not skip a second visit", async () => {
    const { id, dates } = makePlan();
    const [first, second] = await Promise.all([
      call(skipPOST, id, { date: dates[0] }),
      call(skipPOST, id, { date: dates[0] }),
    ]);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(second.status, 200);
    assert.match((await second.json()).message, /already skipped/);
    assert.deepStrictEqual(visitDates(), dates.slice(1));
  });

  test("Skipping today, a past date, a non-visit date or a completed visit is refused", async () => {
    const { id, dates } = makePlan();
    assert.strictEqual((await call(skipPOST, id, { date: localDateString() })).status, 400);
    assert.strictEqual((await call(skipPOST, id, { date: "2020-01-01" })).status, 400);
    assert.strictEqual((await call(skipPOST, id, { date: "not-a-date" })).status, 400);
    assert.strictEqual(
      (await call(skipPOST, id, { date: addDaysToDateString(dates[0], 1) })).status,
      400,
    );
    getDatabase()
      .prepare("UPDATE bookings SET status = 'completed' WHERE subscription_id = ? AND service_date = ?")
      .run(id, dates[0]);
    assert.strictEqual((await call(skipPOST, id, { date: dates[0] })).status, 409);
    assert.strictEqual(visitDates().length, 4);
  });

  test("Only the plan's own customer can change it", async () => {
    const { id, dates } = makePlan();
    assert.strictEqual((await call(skipPOST, id, { date: dates[0] }, null)).status, 401);
    assert.strictEqual(
      (await call(skipPOST, id, { date: dates[0] }, "cleaner@saiping.com")).status,
      403,
    );
    getDatabase()
      .prepare("UPDATE subscriptions SET email = 'someone@example.com' WHERE id = ?")
      .run(id);
    assert.strictEqual((await call(skipPOST, id, { date: dates[0] })).status, 404);
    assert.strictEqual((await call(pausePOST, id, { resumeDate: dates[2] })).status, 404);
    assert.strictEqual((await call(skipPOST, "no-such-plan", { date: dates[0] })).status, 404);
  });

  test("Pausing a fortnightly plan for a vacation removes only the visits in that period", async () => {
    const { id, dates } = makePlan({ frequency: "biweekly", weekday: 3, occurrences: 4 });
    // Away for the first two visits: resume on the third
    const res = await call(pausePOST, id, { resumeDate: dates[2] });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.match(data.message, /paused until .*2 visits won't happen and won't be charged/);
    assert.deepStrictEqual(data.dates, dates.slice(0, 2));
    assert.strictEqual(data.subscription.status, "paused");
    assert.strictEqual(data.subscription.pausedUntil, dates[2]);
    assert.strictEqual(data.subscription.nextVisit.date, dates[2]);
    assert.deepStrictEqual(visitDates(), dates.slice(2));
  });

  test("Paused visits are not charged", async () => {
    const { id, dates } = makePlan({ occurrences: 4 });
    await call(pausePOST, id, { resumeDate: dates[3] });
    const charged = getCustomerBookings(CUSTOMER).bookings.reduce((sum, b) => sum + b.priceCents, 0);
    assert.strictEqual(charged, 8900); // only the one remaining visit
  });

  test("Invalid resume dates are rejected", async () => {
    const { id, dates } = makePlan();
    const today = localDateString();
    for (const resumeDate of [
      "",
      "2026-02-30",
      "2020-01-01",
      today,
      addDaysToDateString(dates[3], 1), // after the last visit
      addDaysToDateString(today, 400), // longer than a year
    ]) {
      const res = await call(pausePOST, id, { resumeDate });
      assert.strictEqual(res.status, 400, `resumeDate ${JSON.stringify(resumeDate)}`);
    }
    assert.strictEqual(plan(id).status, "active");
    assert.strictEqual(visitDates().length, 4);
  });

  test("A paused plan can't be paused again until it is resumed", async () => {
    const { id, dates } = makePlan();
    assert.strictEqual((await call(pausePOST, id, { resumeDate: dates[2] })).status, 200);
    assert.strictEqual((await call(pausePOST, id, { resumeDate: dates[3] })).status, 409);
    assert.strictEqual((await call(resumePOST, id)).status, 200);
    assert.strictEqual((await call(resumePOST, id)).status, 409); // not paused any more
  });

  test("Resume now puts paused visits back and reports any slot that was taken", async () => {
    const { id, dates } = makePlan({ occurrences: 4 });
    await call(pausePOST, id, { resumeDate: dates[3] });
    assert.deepStrictEqual(visitDates(), [dates[3]]);

    // Someone else books the freed 09:00 slot on the second visit date
    const other = createBooking({
      name: "Bob",
      email: "bob@example.com",
      serviceId: "essential",
      date: dates[1],
      time: "09:00",
      address: "1 Silom Rd, Bangkok",
    });
    assert.strictEqual(other.status, "created");

    const res = await call(resumePOST, id);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.subscription.status, "active");
    assert.strictEqual(data.subscription.pausedUntil, null);
    assert.deepStrictEqual(data.dates, [dates[0], dates[2]]);
    assert.match(data.message, /2 paused visits are back.*could not be restored/);
    assert.deepStrictEqual(visitDates(), [dates[0], dates[2], dates[3]]);
  });

  test("Resuming never double-books a visit", async () => {
    const { id, dates } = makePlan({ occurrences: 3 });
    await call(pausePOST, id, { resumeDate: dates[2] });
    await Promise.all([call(resumePOST, id), call(resumePOST, id)]);
    assert.deepStrictEqual(visitDates(), dates);
  });

  test("A plan resumes by itself once the resume date arrives", () => {
    const { id, dates } = makePlan();
    getDatabase()
      .prepare("UPDATE subscriptions SET paused_until = ? WHERE id = ?")
      .run(localDateString(), id); // resume date reached today
    const current = plan(id);
    assert.strictEqual(current.status, "active");
    assert.strictEqual(current.pausedUntil, null);
    assert.strictEqual(current.nextVisit.date, dates[0]);
  });
});
