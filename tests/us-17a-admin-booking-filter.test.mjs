import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createBooking,
  createUserSession,
  getDayOfWeekFromDateString,
  getUserByEmail,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import {
  NOT_ACCEPTED_LABEL,
  NO_MATCHING_BOOKINGS_MESSAGE,
  adminCleanerLabel,
  countBookingsByStatus,
  filterAdminBookings,
} from "../src/lib/admin-bookings.ts";
import { GET as adminBookingsGET } from "../src/app/api/admin/bookings/route.ts";
import { POST as acceptPOST } from "../src/app/api/cleaner/bookings/[id]/accept/route.ts";
import { POST as completePOST } from "../src/app/api/cleaner/bookings/[id]/complete/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

/** The n-th upcoming Monday–Friday date, so both seeded cleaners work it. */
function weekdayDate(n) {
  let date = localDateString();
  let found = 0;
  while (true) {
    date = addDaysToDateString(date, 1);
    const day = getDayOfWeekFromDateString(date);
    if (day >= 1 && day <= 5 && found++ === n) return date;
  }
}

function sessionCookie(email) {
  const user = getUserByEmail(email);
  assert.ok(user, `seed user ${email} exists`);
  return `session_token=${createUserSession(user.id).token}`;
}

function call(handler, url, { cookie, method = "GET", id } = {}) {
  const headers = cookie ? { cookie } : {};
  const request = new Request(`http://localhost${url}`, { method, headers });
  return id === undefined
    ? handler(request)
    : handler(request, { params: Promise.resolve({ id }) });
}

function book(date, time) {
  const result = createBooking({
    name: "Alice Customer",
    email: "customer@saiping.com",
    serviceId: "essential",
    date,
    time,
    address: "12 Test Street",
  });
  assert.equal(result.status, "created", `booking ${date} ${time} created`);
  return result.booking.id;
}

async function accept(id, cleanerEmail = "cleaner@saiping.com") {
  const res = await call(acceptPOST, `/api/cleaner/bookings/${id}/accept`, {
    method: "POST",
    cookie: sessionCookie(cleanerEmail),
    id,
  });
  assert.equal(res.status, 200, "cleaner accepts");
}

async function complete(id, cleanerEmail = "cleaner@saiping.com") {
  const res = await call(completePOST, `/api/cleaner/bookings/${id}/complete`, {
    method: "POST",
    cookie: sessionCookie(cleanerEmail),
    id,
  });
  assert.equal(res.status, 200, "cleaner completes");
}

async function adminBookings() {
  const res = await call(adminBookingsGET, "/api/admin/bookings", {
    cookie: sessionCookie("admin@saiping.com"),
  });
  assert.equal(res.status, 200);
  return (await res.json()).bookings;
}

describe("US-17A: admin filter helpers", () => {
  const sample = [
    { id: "c", date: "2026-12-02", time: "14:00", status: "completed" },
    { id: "a", date: "2026-12-01", time: "14:00", status: "scheduled" },
    { id: "d", date: "2026-12-02", time: "09:00", status: "scheduled" },
    { id: "b", date: "2026-12-01", time: "09:00", status: "completed" },
  ];

  test("All shows every booking sorted by date, then time slot", () => {
    assert.deepEqual(
      filterAdminBookings(sample, "all").map((b) => b.id),
      ["b", "a", "d", "c"],
    );
  });

  test("Scheduled shows only scheduled bookings, still sorted by date", () => {
    assert.deepEqual(
      filterAdminBookings(sample, "scheduled").map((b) => b.id),
      ["a", "d"],
    );
  });

  test("Completed shows only completed bookings, still sorted by date", () => {
    assert.deepEqual(
      filterAdminBookings(sample, "completed").map((b) => b.id),
      ["b", "c"],
    );
  });

  test("filtering does not change the original list", () => {
    const before = sample.map((b) => b.id);
    filterAdminBookings(sample, "scheduled");
    assert.deepEqual(sample.map((b) => b.id), before);
  });

  test("a filter with no matches returns an empty list", () => {
    const onlyScheduled = sample.filter((b) => b.status === "scheduled");
    assert.deepEqual(filterAdminBookings(onlyScheduled, "completed"), []);
    assert.deepEqual(filterAdminBookings([], "all"), []);
    assert.equal(NO_MATCHING_BOOKINGS_MESSAGE, "No bookings match this filter");
  });

  test("counts match what each filter shows", () => {
    assert.deepEqual(countBookingsByStatus(sample), { all: 4, scheduled: 2, completed: 2 });
    assert.deepEqual(countBookingsByStatus([]), { all: 0, scheduled: 0, completed: 0 });
  });

  test('cleaner label is the accepting cleaner, or "Not accepted yet"', () => {
    assert.equal(adminCleanerLabel({ acceptedByName: "Somchai Cleaner" }), "Somchai Cleaner");
    assert.equal(adminCleanerLabel({ acceptedByName: null }), NOT_ACCEPTED_LABEL);
    assert.equal(adminCleanerLabel({ acceptedByName: "   " }), NOT_ACCEPTED_LABEL);
    assert.equal(adminCleanerLabel({}), "Not accepted yet");
  });
});

describe("US-17A: admin bookings API", () => {
  beforeEach(() => {
    resetDatabaseForTesting(new DatabaseSync(":memory:"));
    seedTestUsers();
  });

  afterEach(() => {
    resetDatabaseForTesting(null);
  });

  test("lists every booking sorted by date, then time slot, with the fields the tab shows", async () => {
    const later = weekdayDate(1);
    const sooner = weekdayDate(0);
    const id3 = book(later, "09:00");
    const id2 = book(sooner, "14:00");
    const id1 = book(sooner, "09:00");

    const bookings = await adminBookings();
    assert.deepEqual(bookings.map((b) => b.id), [id1, id2, id3]);
    for (const b of bookings) {
      assert.equal(b.name, "Alice Customer");
      assert.ok(b.serviceName);
      assert.ok(["09:00", "14:00"].includes(b.time));
      assert.ok(["scheduled", "completed"].includes(b.status));
    }
  });

  test('a booking no cleaner has accepted shows "Not accepted yet"; an accepted one shows the cleaner', async () => {
    const open = book(weekdayDate(0), "09:00");
    const taken = book(weekdayDate(0), "14:00");
    await accept(taken);

    const bookings = await adminBookings();
    const openRow = bookings.find((b) => b.id === open);
    const takenRow = bookings.find((b) => b.id === taken);
    assert.equal(adminCleanerLabel(openRow), "Not accepted yet");
    assert.equal(adminCleanerLabel(takenRow), getUserByEmail("cleaner@saiping.com").name);
  });

  test("Scheduled and Completed filters show only matching bookings from real data", async () => {
    const done = book(weekdayDate(0), "09:00");
    const waiting = book(weekdayDate(0), "14:00");
    const acceptedNotDone = book(weekdayDate(1), "09:00");
    await accept(done);
    await complete(done);
    await accept(acceptedNotDone);

    const bookings = await adminBookings();
    assert.deepEqual(
      filterAdminBookings(bookings, "scheduled").map((b) => b.id),
      [waiting, acceptedNotDone],
    );
    assert.deepEqual(filterAdminBookings(bookings, "completed").map((b) => b.id), [done]);
    assert.equal(filterAdminBookings(bookings, "all").length, 3);
  });

  test("Completed filter is empty when nothing is completed yet", async () => {
    book(weekdayDate(0), "09:00");
    const bookings = await adminBookings();
    assert.deepEqual(filterAdminBookings(bookings, "completed"), []);
  });

  test("a customer or cleaner cannot read admin bookings (403); signed out gets 401", async () => {
    book(weekdayDate(0), "09:00");
    for (const email of ["customer@saiping.com", "cleaner@saiping.com"]) {
      const res = await call(adminBookingsGET, "/api/admin/bookings", {
        cookie: sessionCookie(email),
      });
      assert.equal(res.status, 403, `${email} is forbidden`);
      const body = await res.json();
      assert.equal(body.bookings, undefined, "no booking data leaks");
    }
    const anon = await call(adminBookingsGET, "/api/admin/bookings");
    assert.equal(anon.status, 401);
  });
});
