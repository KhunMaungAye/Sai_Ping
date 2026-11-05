import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createUser,
  createUserSession,
  getDatabase,
  getDayOfWeekFromDateString,
  getRecommendedCleaner,
  localDateString,
  resetDatabaseForTesting,
  scoreCleaner,
} from "../src/lib/booking-store.ts";
import { GET as recommendationGET } from "../src/app/api/recommendation/route.ts";

/** A Wednesday at least two weeks ahead, so its whole Mon–Sun week is in the future. */
function futureWednesday() {
  let date = addDaysToDateString(localDateString(), 14);
  while (getDayOfWeekFromDateString(date) !== 3) date = addDaysToDateString(date, 1);
  return date;
}

let historyDay = 0;

/** Adds an active (or suspended) cleaner account. Days: 0 = Sunday … 6 = Saturday. */
function addCleaner(name, { days = "0,1,2,3,4,5,6", status = "active" } = {}) {
  const cleanerId = `cleaner-${name.toLowerCase().replace(/\W+/g, "-")}`;
  getDatabase()
    .prepare("INSERT INTO cleaners (id, name, available_days) VALUES (?, ?, ?)")
    .run(cleanerId, name, days);
  createUser({
    email: `${cleanerId}@example.com`,
    passwordHash: "not-used",
    name,
    role: "cleaner",
    cleanerId,
    status,
  });
  return cleanerId;
}

/** Inserts a booking accepted by `cleanerId`, bypassing the booking rules. */
function insertJob(cleanerId, date, slot, status = "scheduled") {
  const id = `job-${date}-${slot}`;
  getDatabase()
    .prepare(
      `INSERT INTO bookings (id, name, email, service_id, service_name, price_cents,
         service_date, time_slot, address, created_at, cleaner_id, status, accepted_by_id, accepted_by_name)
       VALUES (?, 'Past Customer', 'past@example.com', 'essential', 'Essential Clean', 6000,
         ?, ?, '1 Test Road', ?, ?, ?, ?, 'Cleaner')`,
    )
    .run(id, date, slot, new Date().toISOString(), cleanerId, status, cleanerId);
  return id;
}

/** Gives a cleaner `jobs` completed past cleanings, the first ones rated with `stars`. */
function addHistory(cleanerId, jobs, stars = []) {
  for (let i = 0; i < jobs; i++) {
    const date = addDaysToDateString("2020-01-01", historyDay++);
    const bookingId = insertJob(cleanerId, date, "09:00", "completed");
    if (i < stars.length) {
      getDatabase()
        .prepare(
          "INSERT INTO ratings (id, booking_id, cleaner_id, stars, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(`rating-${bookingId}`, bookingId, cleanerId, stars[i], new Date().toISOString());
    }
  }
}

function addCustomerSession() {
  const user = createUser({
    email: "alice@example.com",
    passwordHash: "not-used",
    name: "Alice",
    role: "customer",
  });
  return createUserSession(user.id).token;
}

function getRecommendation(query, token) {
  const headers = token ? { cookie: `session_token=${token}` } : {};
  return recommendationGET(
    new Request(`http://localhost/api/recommendation?${new URLSearchParams(query)}`, { headers }),
  );
}

describe("AI-01A recommended cleaner", () => {
  let db;
  const date = futureWednesday();

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    resetDatabaseForTesting(db);
    getDatabase();
    historyDay = 0;
  });

  afterEach(() => {
    resetDatabaseForTesting();
    try {
      db.close();
    } catch {}
  });

  describe("scoring rule", () => {
    test("score = 0.7 × rating + 0.3 × 5 × min(jobs, 20) ÷ 20", () => {
      assert.equal(scoreCleaner(5, 0), 3.5);
      assert.equal(scoreCleaner(5, 5), 3.875);
      assert.equal(scoreCleaner(4, 10), 3.55);
      assert.equal(scoreCleaner(5, 20), 5);
    });

    test("jobs are capped at 20", () => {
      assert.equal(scoreCleaner(4, 100), scoreCleaner(4, 20));
      assert.equal(scoreCleaner(4, 21), scoreCleaner(4, 20));
    });

    test("20 jobs at 3 stars scores below 5 jobs at 5 stars", () => {
      assert.ok(scoreCleaner(3, 20) < scoreCleaner(5, 5));
    });

    test("an unrated cleaner counts as 0 stars", () => {
      assert.equal(scoreCleaner(null, 20), 1.5);
    });
  });

  describe("picking the cleaner", () => {
    test("shows the eligible cleaner with the highest score, with name, stars and cleanings", () => {
      const nok = addCleaner("Nok");
      const pim = addCleaner("Pim");
      addHistory(nok, 6, [4, 4, 5]); // 4.33★, 6 jobs → 3.033 + 0.45 = 3.483
      addHistory(pim, 10, [5, 5, 4, 5]); // 4.75★, 10 jobs → 3.325 + 0.75 = 4.075

      const pick = getRecommendedCleaner(date, "09:00");
      assert.equal(pick.cleanerId, pim);
      assert.equal(pick.name, "Pim");
      assert.equal(pick.averageRating, 4.8);
      assert.equal(pick.reviewCount, 4);
      assert.equal(pick.completedJobs, 10);
      assert.equal(pick.reason, "score");
    });

    test("the card's cap case: 20 jobs at 3 stars does not outrank 5 jobs at 5 stars", () => {
      const veteran = addCleaner("Veteran");
      const star = addCleaner("Star");
      addHistory(veteran, 20, Array(20).fill(3));
      addHistory(star, 5, Array(5).fill(5));

      assert.equal(getRecommendedCleaner(date, "09:00").cleanerId, star);
    });

    test("the cap stops a busy 4-star cleaner beating a better-rated one", () => {
      const busy = addCleaner("Busy");
      const better = addCleaner("Better");
      addHistory(busy, 40, Array(10).fill(4)); // capped: 2.8 + 1.5 = 4.3 (uncapped would be 5.8)
      addHistory(better, 15, [5, 5, 5, 5, 4]); // 4.8★: 3.36 + 1.125 = 4.485

      assert.equal(getRecommendedCleaner(date, "09:00").cleanerId, better);
    });

    test("ties on score go to more completed cleanings, then name", () => {
      const ann = addCleaner("Ann");
      const ben = addCleaner("Ben");
      addHistory(ann, 3, [5, 5, 5]);
      addHistory(ben, 3, [5, 5, 5]);
      assert.equal(getRecommendedCleaner(date, "09:00").cleanerId, ann);
    });
  });

  describe("eligibility", () => {
    test("skips suspended cleaners", () => {
      const suspended = addCleaner("Suspended Star", { status: "suspended" });
      const active = addCleaner("Active");
      addHistory(suspended, 20, Array(20).fill(5));
      addHistory(active, 2, [4, 4]);

      assert.equal(getRecommendedCleaner(date, "09:00").cleanerId, active);
    });

    test("skips cleaners who do not work that weekday", () => {
      const weekend = addCleaner("Weekend Star", { days: "0,6" });
      const weekday = addCleaner("Weekday", { days: "1,2,3,4,5" });
      addHistory(weekend, 20, Array(20).fill(5));
      addHistory(weekday, 2, [4, 4]);

      assert.equal(getRecommendedCleaner(date, "09:00").cleanerId, weekday);
    });

    test("skips a cleaner who already has a job in that slot", () => {
      const booked = addCleaner("Booked Star");
      const free = addCleaner("Free");
      addHistory(booked, 20, Array(20).fill(5));
      addHistory(free, 2, [4, 4]);
      insertJob(booked, date, "14:00");

      assert.equal(getRecommendedCleaner(date, "14:00").cleanerId, free);
      assert.equal(getRecommendedCleaner(date, "09:00").cleanerId, booked);
    });

    test("returns null when no cleaner is eligible", () => {
      addCleaner("Weekend Only", { days: "0,6" });
      addCleaner("Gone", { status: "suspended" });
      assert.equal(getRecommendedCleaner(date, "09:00"), null);
    });

    test("returns null when there are no cleaners at all", () => {
      assert.equal(getRecommendedCleaner(date, "09:00"), null);
    });
  });

  describe("fallback when nobody is rated 4.0 or more", () => {
    test("shows the eligible cleaner with the fewest jobs that week", () => {
      const low = addCleaner("Low");
      const fresh = addCleaner("Fresh");
      const mid = addCleaner("Mid");
      addHistory(low, 10, [3, 3, 4]); // 3.33★
      addHistory(mid, 4, [4, 4, 3, 4]); // 3.75★
      // Jobs in the same Mon–Sun week as `date` (Wednesday).
      insertJob(low, addDaysToDateString(date, -2), "09:00"); // Monday
      insertJob(low, addDaysToDateString(date, 1), "09:00"); // Thursday
      insertJob(mid, addDaysToDateString(date, 4), "14:00"); // Sunday
      insertJob(fresh, addDaysToDateString(date, 2), "09:00"); // Friday
      insertJob(fresh, addDaysToDateString(date, 3), "09:00"); // Saturday
      // Next Monday is outside the week and must not count.
      insertJob(mid, addDaysToDateString(date, 5), "09:00");

      const pick = getRecommendedCleaner(date, "09:00");
      assert.equal(pick.cleanerId, mid);
      assert.equal(pick.jobsThisWeek, 1);
      assert.equal(pick.reason, "fallback");
    });

    test("an unrated new cleaner can be the fallback pick", () => {
      const low = addCleaner("Low");
      const newbie = addCleaner("Newbie");
      addHistory(low, 3, [2, 3, 3]);
      insertJob(low, addDaysToDateString(date, 1), "09:00");

      const pick = getRecommendedCleaner(date, "09:00");
      assert.equal(pick.cleanerId, newbie);
      assert.equal(pick.averageRating, null);
      assert.equal(pick.completedJobs, 0);
      assert.equal(pick.reason, "fallback");
    });

    test("exactly 4.0 stars counts as well rated (no fallback)", () => {
      const four = addCleaner("Four");
      const idle = addCleaner("Idle");
      addHistory(four, 2, [4, 4]);
      insertJob(four, addDaysToDateString(date, 1), "09:00");

      const pick = getRecommendedCleaner(date, "09:00");
      assert.equal(pick.cleanerId, four);
      assert.equal(pick.reason, "score");
      assert.notEqual(pick.cleanerId, idle);
    });

    test("an average just under 4.0 (3.96) uses the fallback even though it shows as 4.0", () => {
      const almost = addCleaner("Almost");
      const idle = addCleaner("Idle");
      addHistory(almost, 25, [...Array(24).fill(4), 3]); // 99 / 25 = 3.96
      insertJob(almost, addDaysToDateString(date, 1), "09:00");

      const pick = getRecommendedCleaner(date, "09:00");
      assert.equal(pick.cleanerId, idle);
      assert.equal(pick.reason, "fallback");
    });
  });

  describe("GET /api/recommendation", () => {
    test("returns the recommendation to a signed-in customer", async () => {
      const token = addCustomerSession();
      const pim = addCleaner("Pim");
      addHistory(pim, 3, [5, 5, 4]);

      const response = await getRecommendation({ date, time: "09:00" }, token);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      assert.equal(body.recommendation.name, "Pim");
      assert.equal(body.recommendation.averageRating, 4.7);
      assert.equal(body.recommendation.completedJobs, 3);
    });

    test("a day no active cleaner works is not open, so it gets 409 instead of a recommendation", async () => {
      const token = addCustomerSession();
      addCleaner("Mon Only", { days: "1" });
      addCleaner("Wed Gone", { days: "3", status: "suspended" });

      const wednesday = await getRecommendation({ date, time: "09:00" }, token);
      assert.equal(wednesday.status, 409);

      const monday = addDaysToDateString(date, 5);
      const open = await getRecommendation({ date: monday, time: "09:00" }, token);
      assert.equal(open.status, 200);
      assert.equal((await open.json()).recommendation.name, "Mon Only");
    });

    test("a job in another slot does not stop a cleaner being recommended", async () => {
      const token = addCustomerSession();
      const solo = addCleaner("Solo");
      insertJob(solo, date, "09:00");
      const response = await getRecommendation({ date, time: "14:00" }, token);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).recommendation.name, "Solo");
    });

    test("401 when signed out", async () => {
      addCleaner("Pim");
      const response = await getRecommendation({ date, time: "09:00" });
      assert.equal(response.status, 401);
    });

    test("403 for a cleaner", async () => {
      const cleanerId = addCleaner("Pim");
      const user = getDatabase()
        .prepare("SELECT id FROM users WHERE cleaner_id = ?")
        .get(cleanerId);
      const token = createUserSession(user.id).token;
      const response = await getRecommendation({ date, time: "09:00" }, token);
      assert.equal(response.status, 403);
    });

    test("400 for a missing, malformed or past date", async () => {
      const token = addCustomerSession();
      addCleaner("Pim");
      for (const bad of ["", "2026-13-01", "next week", "2020-01-01"]) {
        const response = await getRecommendation({ date: bad, time: "09:00" }, token);
        assert.equal(response.status, 400, `date ${JSON.stringify(bad)}`);
      }
    });

    test("400 for a time that is not an arrival window", async () => {
      const token = addCustomerSession();
      addCleaner("Pim");
      for (const bad of ["", "10:00", "9am"]) {
        const response = await getRecommendation({ date, time: bad }, token);
        assert.equal(response.status, 400, `time ${JSON.stringify(bad)}`);
      }
    });

    test("409 when the window is already booked", async () => {
      const token = addCustomerSession();
      const pim = addCleaner("Pim");
      insertJob(pim, date, "09:00");
      const response = await getRecommendation({ date, time: "09:00" }, token);
      assert.equal(response.status, 409);
    });
  });
});
