import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  acceptBookingRequest,
  addDaysToDateString,
  createBooking,
  createUserSession,
  getCustomerBookings,
  getDatabase,
  getDayOfWeekFromDateString,
  getUserByEmail,
  localDateString,
  markBookingCompleted,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import {
  NO_REVIEWS_MESSAGE,
  REVIEW_TAGS,
  parseReviewTags,
  readStoredTags,
  summarizeReviews,
} from "../src/lib/review-tags.ts";
import { GET as ratingGET, POST as ratingPOST } from "../src/app/api/bookings/[id]/rating/route.ts";
import { GET as cleanerReviewsGET } from "../src/app/api/cleaner/reviews/route.ts";
import { GET as overviewGET } from "../src/app/api/admin/overview/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const CUSTOMER = "customer@saiping.com";
const CLEANER = "cleaner@saiping.com"; // Sai Ping Cleaner
const CLEANER2 = "cleaner2@saiping.com"; // Mia Cleaner (Mon–Fri)

let dayOffset = 0;
/** A different weekday each call, so every booking gets its own slot. */
function nextWeekday() {
  let date = addDaysToDateString(localDateString(), 1 + dayOffset++);
  while ([0, 6].includes(getDayOfWeekFromDateString(date))) date = addDaysToDateString(date, 1);
  dayOffset = Math.max(dayOffset, 0);
  return date;
}

function cookieFor(email) {
  return `session_token=${createUserSession(getUserByEmail(email).id).token}`;
}

function cleanerIdOf(email) {
  const user = getUserByEmail(email);
  return user.cleanerId || user.id;
}

/** A booking the given cleaner accepted; completed unless told otherwise. */
function job({ cleaner = CLEANER, complete = true, time = "09:00" } = {}) {
  const result = createBooking({
    name: "Alice Customer",
    email: CUSTOMER,
    serviceId: "essential",
    date: nextWeekday(),
    time,
    address: "12 Sukhumvit Soi 24, Bangkok",
  });
  assert.strictEqual(result.status, "created");
  const id = result.booking.id;
  const user = getUserByEmail(cleaner);
  assert.strictEqual(acceptBookingRequest(id, cleanerIdOf(cleaner), user.name).success, true);
  if (complete) {
    markBookingCompleted(id, cleanerIdOf(cleaner), { requireAcceptedBy: cleanerIdOf(cleaner) });
  }
  return id;
}

function rate(id, body, email = CUSTOMER) {
  const headers = { "content-type": "application/json" };
  if (email) headers.cookie = cookieFor(email);
  return ratingPOST(
    new Request(`http://localhost/api/bookings/${id}/rating`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function getRating(id, email = CUSTOMER) {
  return ratingGET(
    new Request(`http://localhost/api/bookings/${id}/rating`, { headers: { cookie: cookieFor(email) } }),
    { params: Promise.resolve({ id }) },
  );
}

function cleanerReviews(email = CLEANER) {
  const headers = email ? { cookie: cookieFor(email) } : {};
  return cleanerReviewsGET(new Request("http://localhost/api/cleaner/reviews", { headers }));
}

describe("US-16 written reviews, tags and cleaner performance view", () => {
  let testDb;

  beforeEach(() => {
    dayOffset = 0;
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

  // ---- AC1: review text box and tag pills on the rating form ------------------

  test("AC1: a customer can save a written review with the Punctual and Detailed tags", async () => {
    const id = job();
    const res = await rate(id, { stars: 5, review: "  Spotless and on time.  ", tags: ["Punctual", "Detailed"] });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.review, "Spotless and on time.");
    assert.deepStrictEqual(body.tags, ["Punctual", "Detailed"]);

    const saved = (await (await getRating(id)).json()).booking;
    assert.strictEqual(saved.rating, 5);
    assert.strictEqual(saved.review, "Spotless and on time.");
    assert.deepStrictEqual(saved.tags, ["Punctual", "Detailed"]);
  });

  test("AC1: the saved tags appear on the customer's booking", async () => {
    const id = job();
    await rate(id, { stars: 4, tags: ["Detailed"] });
    const booking = getCustomerBookings(CUSTOMER).bookings.find((b) => b.id === id);
    assert.deepStrictEqual(booking.reviewTags, ["Detailed"]);
  });

  test("AC1: tags are optional, and their order and duplicates don't matter", async () => {
    const plain = job();
    assert.deepStrictEqual((await (await rate(plain, { stars: 3 })).json()).tags, []);
    const messy = job({ time: "14:00" });
    const res = await rate(messy, { stars: 4, tags: ["Detailed", "Punctual", "Detailed"] });
    assert.deepStrictEqual((await res.json()).tags, ["Punctual", "Detailed"]);
  });

  test("To Do: a confirmation message is returned once the review is saved", async () => {
    const res = await rate(job(), { stars: 5, review: "Great", tags: ["Friendly"] });
    assert.strictEqual(res.status, 201);
    assert.strictEqual((await res.json()).message, "Thank you! Your rating and review have been saved.");
  });

  test("To Do: unknown tags or a wrong type are refused and nothing is saved", async () => {
    const id = job();
    for (const tags of [["Fast"], "Punctual", [1]]) {
      const res = await rate(id, { stars: 5, tags });
      assert.strictEqual(res.status, 400, JSON.stringify(tags));
    }
    assert.match((await (await rate(id, { stars: 5, tags: ["Fast"] })).json()).error, /Choose tags from: Punctual, Detailed/);
    assert.strictEqual((await (await getRating(id)).json()).booking.rating, null);
  });

  test("To Do: a review over 1000 characters is refused", async () => {
    const res = await rate(job(), { stars: 5, review: "x".repeat(1001), tags: ["Punctual"] });
    assert.strictEqual(res.status, 400);
  });

  test("To Do: only completed services can be reviewed", async () => {
    const id = job({ complete: false });
    const res = await rate(id, { stars: 5, tags: ["Punctual"] });
    assert.strictEqual(res.status, 409);
    assert.match((await res.json()).error, /after the service is completed/);
  });

  test("To Do: a booking can only be reviewed once", async () => {
    const id = job();
    await rate(id, { stars: 5, tags: ["Punctual"] });
    assert.strictEqual((await rate(id, { stars: 1, tags: ["Detailed"] })).status, 409);
    assert.deepStrictEqual((await (await getRating(id)).json()).booking.tags, ["Punctual"]);
  });

  // ---- AC2: cleaners and admins see averages and reviews -----------------------

  test("AC2: a cleaner sees their average rating, written reviews and tags", async () => {
    await rate(job(), { stars: 5, review: "Spotless", tags: ["Punctual", "Detailed"] });
    await rate(job({ time: "14:00" }), { stars: 4, tags: ["Punctual"] });
    const res = await cleanerReviews(CLEANER);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("cache-control"), "no-store");
    const { summary, reviews } = await res.json();
    assert.strictEqual(summary.count, 2);
    assert.strictEqual(summary.average, 4.5);
    assert.strictEqual(summary.writtenCount, 1);
    assert.deepStrictEqual(summary.tagCounts, [
      { tag: "Punctual", count: 2 },
      { tag: "Detailed", count: 1 },
    ]);
    assert.deepStrictEqual(
      reviews.map((r) => r.stars).sort(),
      [4, 5],
    );
    assert.ok(reviews.some((r) => r.review === "Spotless" && r.tags.includes("Detailed")));
  });

  test("AC2: a cleaner only sees their own ratings, never another cleaner's", async () => {
    await rate(job({ cleaner: CLEANER }), { stars: 5, tags: ["Punctual"] });
    await rate(job({ cleaner: CLEANER2, time: "14:00" }), { stars: 2, review: "Late" });
    const mine = await (await cleanerReviews(CLEANER)).json();
    assert.strictEqual(mine.summary.count, 1);
    assert.ok(mine.reviews.every((r) => r.review !== "Late"));
    const theirs = await (await cleanerReviews(CLEANER2)).json();
    assert.strictEqual(theirs.summary.count, 1);
    assert.strictEqual(theirs.reviews[0].review, "Late");
  });

  test("AC2: cleaners see the customer's name but not their email", async () => {
    await rate(job(), { stars: 5 });
    const { reviews } = await (await cleanerReviews(CLEANER)).json();
    assert.strictEqual(reviews[0].customerName, "Alice Customer");
    assert.strictEqual(reviews[0].customerEmail, undefined);
  });

  test("AC2: an admin sees every cleaner's reviews with their tags", async () => {
    await rate(job({ cleaner: CLEANER }), { stars: 5, tags: ["Punctual", "Detailed"] });
    await rate(job({ cleaner: CLEANER2, time: "14:00" }), { stars: 3, review: "OK" });
    const res = await overviewGET(
      new Request("http://localhost/api/admin/overview", { headers: { cookie: cookieFor("admin@saiping.com") } }),
    );
    const { reviews } = await res.json();
    assert.strictEqual(reviews.length, 2);
    assert.deepStrictEqual(
      reviews.find((r) => r.cleanerName === "Sai Ping Cleaner").tags,
      ["Punctual", "Detailed"],
    );
    assert.deepStrictEqual(summarizeReviews(reviews).average, 4);
  });

  test("To Do: a cleaner with no ratings gets an empty list and no average", async () => {
    const { summary, reviews } = await (await cleanerReviews(CLEANER)).json();
    assert.deepStrictEqual(reviews, []);
    assert.strictEqual(summary.count, 0);
    assert.strictEqual(summary.average, null);
  });

  test("Access: the cleaner reviews page needs a signed-in cleaner", async () => {
    assert.strictEqual((await cleanerReviews(null)).status, 401);
    assert.strictEqual((await cleanerReviews(CUSTOMER)).status, 403);
    assert.strictEqual((await cleanerReviews("admin@saiping.com")).status, 403);
  });

  test("Access: a cleaner can't submit a rating", async () => {
    const res = await rate(job(), { stars: 5, tags: ["Punctual"] }, CLEANER);
    assert.strictEqual(res.status, 403);
  });
});

describe("US-16 review tag helpers", () => {
  test("Punctual and Detailed are offered", () => {
    assert.ok(REVIEW_TAGS.includes("Punctual"));
    assert.ok(REVIEW_TAGS.includes("Detailed"));
  });

  test("parseReviewTags accepts missing tags and rejects unknown ones", () => {
    assert.deepStrictEqual(parseReviewTags(undefined), { ok: true, tags: [] });
    assert.deepStrictEqual(parseReviewTags(["Detailed", "Punctual"]), { ok: true, tags: ["Punctual", "Detailed"] });
    assert.strictEqual(parseReviewTags(["Rude"]).ok, false);
  });

  test("readStoredTags ignores missing or broken data", () => {
    assert.deepStrictEqual(readStoredTags(null), []);
    assert.deepStrictEqual(readStoredTags("not json"), []);
    assert.deepStrictEqual(readStoredTags('["Punctual","Bogus"]'), []);
    assert.deepStrictEqual(readStoredTags('["Friendly"]'), ["Friendly"]);
  });

  test("summarizeReviews rounds the average to one decimal and sorts tags by use", () => {
    const summary = summarizeReviews([
      { stars: 5, review: null, tags: ["Detailed"] },
      { stars: 4, review: "Good", tags: ["Detailed", "Punctual"] },
      { stars: 4, review: null, tags: [] },
    ]);
    assert.strictEqual(summary.average, 4.3);
    assert.deepStrictEqual(summary.tagCounts, [
      { tag: "Detailed", count: 2 },
      { tag: "Punctual", count: 1 },
    ]);
    assert.strictEqual(summary.writtenCount, 1);
    assert.strictEqual(summarizeReviews([]).average, null);
  });

  test("the empty-state message is clear", () => {
    assert.strictEqual(NO_REVIEWS_MESSAGE, "No ratings or reviews yet.");
  });
});
