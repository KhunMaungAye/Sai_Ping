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
  updateUserStatus,
} from "../src/lib/booking-store.ts";
import { formatAverageRating, sortCleanerSummaries } from "../src/lib/cleaner-ratings.ts";
import { POST as acceptPOST } from "../src/app/api/cleaner/bookings/[id]/accept/route.ts";
import { POST as completePOST } from "../src/app/api/cleaner/bookings/[id]/complete/route.ts";
import { POST as ratingPOST } from "../src/app/api/bookings/[id]/rating/route.ts";
import { GET as overviewGET } from "../src/app/api/admin/overview/route.ts";
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

let slot = 0;

/** Books a visit, has `cleanerEmail` accept and complete it, and rates it if `stars` is given. */
async function completedJob(cleanerEmail, stars) {
  const date = weekdayDate(Math.floor(slot / 2));
  const time = slot % 2 === 0 ? "09:00" : "14:00";
  slot += 1;

  const result = createBooking({
    name: "Alice Customer",
    email: "customer@saiping.com",
    serviceId: "essential",
    date,
    time,
    address: "12 Test Street",
  });
  assert.equal(result.status, "created", `booking ${date} ${time} created`);
  const id = result.booking.id;

  const cleaner = sessionCookie(cleanerEmail);
  const accepted = await call(acceptPOST, `/api/cleaner/bookings/${id}/accept`, { cookie: cleaner, id });
  assert.equal(accepted.status, 200);
  const completed = await call(completePOST, `/api/cleaner/bookings/${id}/complete`, { cookie: cleaner, id });
  assert.equal(completed.status, 200);

  if (stars !== undefined) {
    const rated = await call(ratingPOST, `/api/bookings/${id}/rating`, {
      cookie: sessionCookie("customer@saiping.com"),
      body: { stars },
      id,
    });
    assert.equal(rated.status, 201);
  }
}

async function adminCleaners() {
  const res = await call(overviewGET, "/api/admin/overview", {
    method: "GET",
    cookie: sessionCookie("admin@saiping.com"),
  });
  assert.equal(res.status, 200);
  const { cleaners } = await res.json();
  return {
    all: cleaners,
    byEmail: (email) => cleaners.find((c) => c.email === email),
  };
}

describe("US-17B: admin cleaner rating summary", () => {
  beforeEach(() => {
    resetDatabaseForTesting(new DatabaseSync(":memory:"));
    seedTestUsers();
    slot = 0;
  });

  afterEach(() => {
    resetDatabaseForTesting();
  });

  test("shows completed jobs, number of ratings and average stars to one decimal", async () => {
    await completedJob("cleaner@saiping.com", 4);
    await completedJob("cleaner@saiping.com", 5);
    await completedJob("cleaner@saiping.com", 4);

    const c = (await adminCleaners()).byEmail("cleaner@saiping.com");
    assert.equal(c.completedJobs, 3);
    assert.equal(c.reviewCount, 3);
    // (4 + 5 + 4) / 3 = 4.333… → 4.3
    assert.equal(c.averageRating, 4.3);
    assert.equal(formatAverageRating(c.averageRating), "4.3");
  });

  test("a whole-number average still shows one decimal place", () => {
    assert.equal(formatAverageRating(5), "5.0");
    assert.equal(formatAverageRating(3), "3.0");
  });

  test("averages match submitted ratings and are credited to the cleaner who did the job", async () => {
    await completedJob("cleaner@saiping.com", 5);
    await completedJob("cleaner2@saiping.com", 2);
    await completedJob("cleaner2@saiping.com", 3);

    const { byEmail } = await adminCleaners();
    const first = byEmail("cleaner@saiping.com");
    const second = byEmail("cleaner2@saiping.com");

    assert.equal(first.reviewCount, 1);
    assert.equal(first.averageRating, 5);
    assert.equal(second.reviewCount, 2);
    assert.equal(second.averageRating, 2.5);
  });

  test("a cleaner with completed jobs but 0 ratings shows 'No ratings yet', not 0.0", async () => {
    await completedJob("cleaner2@saiping.com");
    await completedJob("cleaner2@saiping.com");

    const c = (await adminCleaners()).byEmail("cleaner2@saiping.com");
    assert.equal(c.completedJobs, 2);
    assert.equal(c.reviewCount, 0);
    assert.equal(c.averageRating, null);
    assert.equal(formatAverageRating(c.averageRating), "No ratings yet");
  });

  test("a completed job that has not been rated yet does not change the average", async () => {
    await completedJob("cleaner@saiping.com", 2);
    await completedJob("cleaner@saiping.com");

    const c = (await adminCleaners()).byEmail("cleaner@saiping.com");
    assert.equal(c.completedJobs, 2);
    assert.equal(c.reviewCount, 1);
    assert.equal(c.averageRating, 2);
  });

  test("a suspended cleaner still appears, marked as suspended, with their history", async () => {
    await completedJob("cleaner2@saiping.com", 3);
    updateUserStatus(getUserByEmail("cleaner2@saiping.com").id, "suspended");

    const c = (await adminCleaners()).byEmail("cleaner2@saiping.com");
    assert.ok(c, "suspended cleaner is still listed");
    assert.equal(c.status, "suspended");
    assert.equal(c.completedJobs, 1);
    assert.equal(c.reviewCount, 1);
    assert.equal(c.averageRating, 3);
  });

  test("customers and cleaners cannot open the table (403), signed-out users get 401", async () => {
    for (const email of ["customer@saiping.com", "cleaner@saiping.com"]) {
      const res = await call(overviewGET, "/api/admin/overview", {
        method: "GET",
        cookie: sessionCookie(email),
      });
      assert.equal(res.status, 403, `${email} is refused`);
    }

    const signedOut = await call(overviewGET, "/api/admin/overview", { method: "GET" });
    assert.equal(signedOut.status, 401);
  });

  test("sorting by average rating puts the lowest first", async () => {
    await completedJob("cleaner@saiping.com", 5);
    await completedJob("cleaner2@saiping.com", 2);

    const { all } = await adminCleaners();
    const sorted = sortCleanerSummaries(all, "rating-asc");
    assert.deepEqual(
      sorted.map((c) => c.email),
      ["cleaner2@saiping.com", "cleaner@saiping.com"],
    );
  });
});

describe("US-17B: sortCleanerSummaries", () => {
  const cleaners = [
    { name: "Dara", averageRating: null, reviewCount: 0 },
    { name: "Arun", averageRating: 4.8, reviewCount: 10 },
    { name: "Chai", averageRating: 3.1, reviewCount: 2 },
    { name: "Bee", averageRating: null, reviewCount: 0 },
    { name: "Ploy", averageRating: 3.1, reviewCount: 9 },
  ];

  test("lowest average first, cleaners without ratings last", () => {
    assert.deepEqual(
      sortCleanerSummaries(cleaners, "rating-asc").map((c) => c.name),
      ["Ploy", "Chai", "Arun", "Bee", "Dara"],
    );
  });

  test("equal averages: the cleaner with more ratings comes first", () => {
    const [first, second] = sortCleanerSummaries(cleaners, "rating-asc");
    assert.equal(first.name, "Ploy");
    assert.equal(second.name, "Chai");
  });

  test("name sort is A–Z", () => {
    assert.deepEqual(
      sortCleanerSummaries(cleaners, "name").map((c) => c.name),
      ["Arun", "Bee", "Chai", "Dara", "Ploy"],
    );
  });

  test("does not change the original list and handles an empty list", () => {
    const before = cleaners.map((c) => c.name);
    sortCleanerSummaries(cleaners, "rating-asc");
    assert.deepEqual(cleaners.map((c) => c.name), before);
    assert.deepEqual(sortCleanerSummaries([], "rating-asc"), []);
  });
});
