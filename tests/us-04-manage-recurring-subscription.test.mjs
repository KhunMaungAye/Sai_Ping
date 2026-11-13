import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  acceptBookingRequest,
  addDaysToDateString,
  createBooking,
  createRecurringSubscription,
  createUser,
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
import {
  NO_CHANGES_MESSAGE,
  parseSubscriptionChanges,
} from "../src/lib/subscription-changes.ts";
import { POST as updatePOST } from "../src/app/api/subscriptions/[id]/update/route.ts";
import { POST as pausePOST } from "../src/app/api/subscriptions/[id]/pause/route.ts";
import { POST as skipPOST } from "../src/app/api/subscriptions/[id]/skip/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const CUSTOMER = "customer@saiping.com";

function nextWeekday(weekday, from = localDateString()) {
  let date = addDaysToDateString(from, 1);
  while (getDayOfWeekFromDateString(date) !== weekday) date = addDaysToDateString(date, 1);
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
    specialInstructions: "Door code 1234",
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

const visits = () =>
  getCustomerBookings(CUSTOMER).bookings.sort((a, b) => a.date.localeCompare(b.date));
const plan = (id) => listCustomerSubscriptions(CUSTOMER).find((p) => p.id === id);

function acceptVisit(date) {
  const visit = visits().find((b) => b.date === date);
  const cleaner = getUserByEmail("cleaner@saiping.com");
  const result = acceptBookingRequest(visit.id, cleaner.cleanerId || cleaner.id, cleaner.name);
  assert.strictEqual(result.success, true);
}

/** A snapshot of everything a failed change must leave alone. */
function snapshot(id) {
  return JSON.stringify({ plan: plan(id), visits: visits() });
}

describe("US-04 manage a recurring subscription", () => {
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

  // ---- AC1: change frequency / details ------------------------------------

  test("AC1 frequency: weekly to every 2 weeks rebuilds the upcoming visits 14 days apart", async () => {
    const { id, dates } = makePlan({ frequency: "weekly", occurrences: 4 });
    const res = await call(updatePOST, id, { frequency: "biweekly" });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.subscription.frequency, "biweekly");

    const after = visits().map((v) => v.date);
    assert.strictEqual(after.length, 4, "keeps the same number of visits");
    assert.strictEqual(after[0], dates[0], "the first visit stays on the same day");
    for (let i = 1; i < after.length; i++) {
      assert.strictEqual(after[i], addDaysToDateString(after[i - 1], 14));
    }
  });

  test("AC1 day and time: visits move to the new weekday and arrival time, and the old slots are freed", async () => {
    const { id, dates } = makePlan({ weekday: 2, time: "09:00" });
    const res = await call(updatePOST, id, { preferredDay: "Thursday", time: "14:00" });
    assert.strictEqual(res.status, 200);

    const after = visits();
    assert.strictEqual(after.length, dates.length);
    for (const visit of after) {
      assert.strictEqual(getDayOfWeekFromDateString(visit.date), 4);
      assert.strictEqual(visit.time, "14:00");
    }
    assert.strictEqual(plan(id).preferredDay, "Thursday");
    assert.strictEqual(plan(id).time, "14:00");
    assert.ok(listAvailableSlots(dates[0]).includes("09:00"), "the old Tuesday 9:00 slot is free again");
  });

  test("AC1 details: service, address and note change on every upcoming visit and the price follows the service", async () => {
    const { id } = makePlan();
    const res = await call(updatePOST, id, {
      serviceId: "deep",
      address: "88 Silom Road, Bangkok",
      specialInstructions: "Key under the mat",
    });
    assert.strictEqual(res.status, 200);
    for (const visit of visits()) {
      assert.strictEqual(visit.serviceId, "deep");
      assert.strictEqual(visit.serviceName, "Deep clean");
      assert.strictEqual(visit.priceCents, 14900);
      assert.strictEqual(visit.address, "88 Silom Road, Bangkok");
      assert.strictEqual(visit.specialInstructions, "Key under the mat");
    }
    const updated = plan(id);
    assert.strictEqual(updated.serviceId, "deep");
    assert.strictEqual(updated.priceCents, 14900);
    assert.strictEqual(updated.specialInstructions, "Key under the mat");
  });

  test("AC1 details: an empty note clears the special instructions", async () => {
    const { id } = makePlan();
    const res = await call(updatePOST, id, { specialInstructions: "  " });
    assert.strictEqual(res.status, 200);
    assert.ok(visits().every((v) => v.specialInstructions === null));
  });

  test("AC1 details: a completed visit keeps what the customer originally booked", async () => {
    const { id, dates } = makePlan();
    getDatabase()
      .prepare("UPDATE bookings SET status = 'completed' WHERE service_date = ?")
      .run(dates[0]);
    const res = await call(updatePOST, id, { address: "88 Silom Road, Bangkok" });
    assert.strictEqual(res.status, 200);
    const [completed, ...rest] = visits();
    assert.strictEqual(completed.address, "12 Sukhumvit Soi 24, Bangkok");
    assert.ok(rest.every((v) => v.address === "88 Silom Road, Bangkok"));
  });

  test("AC1 pause: the plan can still be paused (US-15 route)", async () => {
    const { id, dates } = makePlan();
    const res = await call(pausePOST, id, { resumeDate: dates[2] });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(plan(id).status, "paused");
  });

  // ---- AC2 / AC3: confirmation only after a successful save ----------------

  test("AC2/AC3: the reply confirms the change after it is saved", async () => {
    const { id } = makePlan({ weekday: 2 });
    const res = await call(updatePOST, id, { frequency: "biweekly", preferredDay: "Wednesday", time: "14:00" });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.match(data.message, /^Your plan is updated\./);
    assert.match(data.message, /every 2 weeks on Wednesdays at 2:00 PM/);
    assert.match(data.message, /Your next cleaning is Wednesday, /);
    // Saved: a fresh read shows the same values the message promised.
    assert.strictEqual(plan(id).frequency, "biweekly");
    assert.strictEqual(plan(id).preferredDay, "Wednesday");
  });

  test("AC2/AC3: a detail change names what changed in the confirmation", async () => {
    const { id } = makePlan();
    const data = await (await call(updatePOST, id, { address: "88 Silom Road, Bangkok" })).json();
    assert.match(data.message, /Your upcoming visits now use the new address\./);
  });

  test("AC2/AC3: when a change fails, nothing is saved and no confirmation is sent", async () => {
    const { id, dates } = makePlan({ weekday: 2 });
    const thursday = nextWeekday(4, addDaysToDateString(dates[0], -1));
    const other = createBooking({
      name: "Bob",
      email: "bob@example.com",
      serviceId: "essential",
      date: thursday,
      time: "09:00",
      address: "1 Rama IV Road, Bangkok",
    });
    assert.strictEqual(other.status, "created");
    const before = snapshot(id);
    const res = await call(updatePOST, id, { preferredDay: "Thursday" });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.message, undefined);
    assert.match(data.error, /^Your plan wasn't changed: Thursday, .* at 9:00 AM is already booked/);
    assert.strictEqual(snapshot(id), before);
  });

  // ---- Edge cases ----------------------------------------------------------

  test("Edge: no cleaner works the new day, so the plan is not changed", async () => {
    const { id } = makePlan({ weekday: 2 });
    getDatabase().prepare("UPDATE cleaners SET available_days = '1,2,3,4,5'").run();
    const before = snapshot(id);
    const res = await call(updatePOST, id, { preferredDay: "Sunday" });
    assert.strictEqual(res.status, 409);
    assert.match((await res.json()).error, /no cleaner works that day/);
    assert.strictEqual(snapshot(id), before);
  });

  test("Edge: removing a visit a cleaner accepted asks first, then goes ahead when confirmed", async () => {
    const { id, dates } = makePlan({ weekday: 2 });
    acceptVisit(dates[1]);
    const res = await call(updatePOST, id, { preferredDay: "Thursday" });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.needsConfirmation, true);
    assert.match(data.error, /A cleaner has already accepted your .* visit\. If you change the schedule, they lose this job\./);
    assert.ok(visits().some((v) => v.date === dates[1]), "nothing changed yet");

    const confirmed = await call(updatePOST, id, { preferredDay: "Thursday", confirmAccepted: true });
    assert.strictEqual(confirmed.status, 200);
    assert.ok(visits().every((v) => getDayOfWeekFromDateString(v.date) === 4));
  });

  test("Edge: changing only the address keeps an accepted visit and its cleaner", async () => {
    const { id, dates } = makePlan();
    acceptVisit(dates[0]);
    const res = await call(updatePOST, id, { address: "88 Silom Road, Bangkok" });
    assert.strictEqual(res.status, 200);
    const accepted = visits().find((v) => v.date === dates[0]);
    assert.strictEqual(accepted.isAccepted, true);
    assert.strictEqual(accepted.address, "88 Silom Road, Bangkok");
  });

  test("Edge: switching to every 2 weeks keeps visits that are still on the schedule", async () => {
    const { id, dates } = makePlan({ frequency: "weekly" });
    acceptVisit(dates[0]);
    // dates[0] stays on the new schedule, so no confirmation is needed and the cleaner keeps it.
    const res = await call(updatePOST, id, { frequency: "biweekly" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(visits().find((v) => v.date === dates[0]).isAccepted, true);
  });

  test("Edge: a skipped date stays skipped when it is still on the schedule", async () => {
    const { id, dates } = makePlan({ frequency: "weekly", occurrences: 4 });
    // dates[2] is two weeks after dates[0], so it stays on an every-2-weeks schedule.
    const skip = await call(skipPOST, id, { date: dates[2] });
    assert.strictEqual(skip.status, 200);

    const res = await call(updatePOST, id, { frequency: "biweekly" });
    assert.strictEqual(res.status, 200);
    const after = visits().map((v) => v.date);
    assert.ok(!after.includes(dates[2]), "the skipped visit was not booked again");
    assert.ok(after.includes(dates[0]));
    assert.ok(plan(id).skippedVisits.some((s) => s.date === dates[2]), "the skip is still listed");
  });

  test("Edge: a paused plan can change details but not its schedule", async () => {
    const { id, dates } = makePlan();
    await call(pausePOST, id, { resumeDate: dates[2] });
    const schedule = await call(updatePOST, id, { frequency: "biweekly" });
    assert.strictEqual(schedule.status, 409);
    assert.match((await schedule.json()).error, /Resume your plan before changing its day, time or how often/);

    const details = await call(updatePOST, id, { address: "88 Silom Road, Bangkok" });
    assert.strictEqual(details.status, 200);
    assert.strictEqual(plan(id).status, "paused");
  });

  test("Edge: sending the plan's current values is refused as no change", async () => {
    const { id } = makePlan();
    const res = await call(updatePOST, id, { frequency: "weekly", address: "12 Sukhumvit Soi 24, Bangkok" });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /Nothing changed/);
  });

  test("Edge: an empty request is refused", async () => {
    const { id } = makePlan();
    const res = await call(updatePOST, id, {});
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error, NO_CHANGES_MESSAGE);
  });

  test("Edge: invalid values are refused with a clear message", async () => {
    const { id } = makePlan();
    const cases = [
      [{ frequency: "monthly" }, /Weekly or Every 2 Weeks/],
      [{ preferredDay: "Funday" }, /day of the week/],
      [{ time: "18:00" }, /9:00 AM or 2:00 PM/],
      [{ serviceId: "window-wash" }, /cleaning service/],
      [{ address: "abc" }, /full service address/],
      [{ specialInstructions: "x".repeat(251) }, /250 characters or fewer/],
    ];
    for (const [body, message] of cases) {
      const res = await call(updatePOST, id, body);
      assert.strictEqual(res.status, 400, JSON.stringify(body));
      assert.match((await res.json()).error, message);
    }
  });

  test("Edge: a cancelled plan cannot be changed", async () => {
    const { id } = makePlan();
    getDatabase().prepare("UPDATE subscriptions SET status = 'cancelled' WHERE id = ?").run(id);
    const res = await call(updatePOST, id, { frequency: "biweekly" });
    assert.strictEqual(res.status, 409);
  });

  // ---- Access rules ---------------------------------------------------------

  test("Access: a signed-out visitor gets 401", async () => {
    const { id } = makePlan();
    const res = await call(updatePOST, id, { frequency: "biweekly" }, null);
    assert.strictEqual(res.status, 401);
  });

  test("Access: cleaners and admins get 403", async () => {
    const { id } = makePlan();
    for (const email of ["cleaner@saiping.com", "admin@saiping.com"]) {
      const res = await call(updatePOST, id, { frequency: "biweekly" }, email);
      assert.strictEqual(res.status, 403, email);
    }
  });

  test("Access: another customer's plan is reported as not found and stays unchanged", async () => {
    const { id } = makePlan();
    createUser({ email: "bob@example.com", passwordHash: "x", name: "Bob", role: "customer" });
    const before = snapshot(id);
    const res = await call(updatePOST, id, { frequency: "biweekly" }, "bob@example.com");
    assert.strictEqual(res.status, 404);
    assert.strictEqual(snapshot(id), before);
  });
});

describe("US-04 parseSubscriptionChanges", () => {
  test("keeps only the fields that were sent, normalised", () => {
    const result = parseSubscriptionChanges({ preferredDay: "wednesday", address: "  88 Silom Road  " });
    assert.deepStrictEqual(result, {
      ok: true,
      changes: { preferredDay: "Wednesday", address: "88 Silom Road" },
    });
  });

  test("an empty note becomes null so it clears the instructions", () => {
    assert.deepStrictEqual(parseSubscriptionChanges({ specialInstructions: "" }), {
      ok: true,
      changes: { specialInstructions: null },
    });
  });

  test("no fields means no change", () => {
    assert.deepStrictEqual(parseSubscriptionChanges({ confirmAccepted: true }), {
      ok: false,
      error: NO_CHANGES_MESSAGE,
    });
  });
});
