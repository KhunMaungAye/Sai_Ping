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
  listReplacementCleaners,
  localDateString,
  resetDatabaseForTesting,
  SERVICES,
  TIME_SLOTS,
} from "../src/lib/booking-store.ts";
import {
  TRAVEL_TIME_BLOCKED_MESSAGE,
  TRAVEL_TIME_MINUTES,
  findTravelConflict,
  jobWindow,
  tooClose,
} from "../src/lib/travel-time.ts";
import { POST as acceptPOST } from "../src/app/api/cleaner/bookings/[id]/accept/route.ts";
import {
  GET as reassignOptionsGET,
  POST as reassignPOST,
} from "../src/app/api/admin/bookings/[id]/reassign/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

// "Somchai" in the card's examples; works every day.
const SOMCHAI = "cleaner@saiping.com";
// Works Monday–Friday.
const MIA = "cleaner2@saiping.com";
const ADMIN = "admin@saiping.com";

function nextFriday() {
  let date = addDaysToDateString(localDateString(), 1);
  while (getDayOfWeekFromDateString(date) !== 5) date = addDaysToDateString(date, 1);
  return date;
}

function cookieFor(email) {
  return `session_token=${createUserSession(getUserByEmail(email).id).token}`;
}

function cleanerIdOf(email) {
  const user = getUserByEmail(email);
  return user.cleanerId || user.id;
}

/** An open request. 12:30 is a test-only start time, as the card suggests. */
function book(time, serviceId = "essential", date = nextFriday()) {
  const result = createBooking({
    name: "Alice Customer",
    email: "customer@saiping.com",
    serviceId,
    date,
    time,
    address: "12 Sukhumvit Soi 24, Bangkok",
  });
  assert.strictEqual(result.status, "created", `${date} ${time}`);
  return result.booking.id;
}

function accept(id, email = SOMCHAI) {
  return acceptPOST(
    new Request(`http://localhost/api/cleaner/bookings/${id}/accept`, {
      method: "POST",
      headers: { cookie: cookieFor(email) },
    }),
    { params: Promise.resolve({ id }) },
  );
}

const acceptedBy = (id) =>
  getDatabase().prepare("SELECT accepted_by_id FROM bookings WHERE id = ?").get(id).accepted_by_id;

describe("AI-02A block jobs without enough travel time", () => {
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

  // ---- AC2 + the card's first example ------------------------------------------

  test("AC2: Deep clean 09:00–12:00, then a 12:30 job is blocked and not saved", async () => {
    const deep = book("09:00", "deep");
    assert.strictEqual((await accept(deep)).status, 200);
    const tooSoon = book("12:30");
    const res = await accept(tooSoon);
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).error, "Slot unavailable: travel time needed");
    assert.strictEqual(acceptedBy(tooSoon), null, "the job stays an open request");
  });

  test("AC2: a job that would end too close to a later job is blocked too", async () => {
    const afternoon = book("14:00");
    assert.strictEqual((await accept(afternoon)).status, 200);
    // Essential 12:30–14:30 overlaps the 14:00 job.
    const res = await accept(book("12:30"));
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).error, TRAVEL_TIME_BLOCKED_MESSAGE);
  });

  // ---- AC3 + the card's second example ----------------------------------------

  test("AC3: Move-out 09:00–13:00, then a 14:00 job is accepted (exactly 60 minutes)", async () => {
    const moveOut = book("09:00", "move-out");
    assert.strictEqual((await accept(moveOut)).status, 200);
    const next = book("14:00");
    const res = await accept(next);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(acceptedBy(next), cleanerIdOf(SOMCHAI));
  });

  // ---- Edge cases from the card ------------------------------------------------

  test("Edge: jobs on different days never conflict", async () => {
    const friday = nextFriday();
    assert.strictEqual((await accept(book("09:00", "move-out", friday))).status, 200);
    const thursday = addDaysToDateString(friday, -1);
    assert.strictEqual((await accept(book("12:30", "deep", thursday))).status, 200);
    const nextWeek = addDaysToDateString(friday, 7);
    assert.strictEqual((await accept(book("12:30", "deep", nextWeek))).status, 200);
  });

  test("Edge: another cleaner's jobs don't block this cleaner", async () => {
    assert.strictEqual((await accept(book("09:00", "deep"), MIA)).status, 200);
    assert.strictEqual((await accept(book("12:30"), SOMCHAI)).status, 200);
  });

  test("Edge: a job already marked completed doesn't block the next one", async () => {
    const deep = book("09:00", "deep");
    await accept(deep);
    getDatabase().prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").run(deep);
    assert.strictEqual((await accept(book("12:30"))).status, 200);
  });

  test("Edge: today's real start times (09:00, 14:00) never conflict", () => {
    for (const morning of SERVICES) {
      for (const afternoon of SERVICES) {
        assert.strictEqual(
          tooClose(
            { date: "2026-11-20", time: TIME_SLOTS[0], serviceId: morning.id },
            { date: "2026-11-20", time: TIME_SLOTS[1], serviceId: afternoon.id },
          ),
          false,
          `${morning.id} then ${afternoon.id}`,
        );
      }
    }
  });

  // ---- AC2: "or be assigned" — admin reassignment (US-10) and no-shows (US-09) ----

  test("AC2: the admin can't assign a job that is too close to the cleaner's other job", async () => {
    await accept(book("09:00", "deep"), SOMCHAI);
    const tooSoon = book("12:30");
    const res = await reassignPOST(
      new Request(`http://localhost/api/admin/bookings/${tooSoon}/reassign`, {
        method: "POST",
        headers: { cookie: cookieFor(ADMIN), "content-type": "application/json" },
        body: JSON.stringify({ cleanerId: cleanerIdOf(SOMCHAI) }),
      }),
      { params: Promise.resolve({ id: tooSoon }) },
    );
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).error, TRAVEL_TIME_BLOCKED_MESSAGE);
    assert.strictEqual(acceptedBy(tooSoon), null);
  });

  test("AC2: the admin's list of available cleaners leaves out anyone without travel time", async () => {
    await accept(book("09:00", "deep"), SOMCHAI);
    const tooSoon = book("12:30");
    const res = await reassignOptionsGET(
      new Request(`http://localhost/api/admin/bookings/${tooSoon}/reassign`, {
        headers: { cookie: cookieFor(ADMIN) },
      }),
      { params: Promise.resolve({ id: tooSoon }) },
    );
    const names = (await res.json()).cleaners.map((c) => c.name);
    assert.ok(!names.includes("Sai Ping Cleaner"));
    assert.ok(names.includes("Mia Cleaner"));
  });

  test("AC2: no-show replacements (US-09) also respect travel time", async () => {
    await accept(book("09:00", "deep"), SOMCHAI);
    const tooSoon = book("12:30");
    const date = nextFriday();
    const withRule = listReplacementCleaners(date, "nobody", tooSoon).map((c) => c.name);
    const withoutRule = listReplacementCleaners(date, "nobody").map((c) => c.name);
    assert.ok(!withRule.includes("Sai Ping Cleaner"));
    assert.ok(withoutRule.includes("Sai Ping Cleaner"));
  });
});

describe("AI-02A travel-time rule", () => {
  test("AC1: a job ends after its service length (Essential 2h, Deep 3h, Move-out 4h)", () => {
    assert.deepStrictEqual(jobWindow({ time: "09:00", serviceId: "essential" }), { start: 540, end: 660 });
    assert.deepStrictEqual(jobWindow({ time: "09:00", serviceId: "deep" }), { start: 540, end: 720 });
    assert.deepStrictEqual(jobWindow({ time: "09:00", serviceId: "move-out" }), { start: 540, end: 780 });
  });

  test("the gap is 60 minutes", () => {
    assert.strictEqual(TRAVEL_TIME_MINUTES, 60);
  });

  test("AC2/AC3: 59 minutes is too close, exactly 60 is allowed, either order", () => {
    const deep = { date: "2026-11-20", time: "09:00", serviceId: "deep" }; // ends 12:00
    assert.strictEqual(tooClose(deep, { date: "2026-11-20", time: "12:59", serviceId: "essential" }), true);
    assert.strictEqual(tooClose(deep, { date: "2026-11-20", time: "13:00", serviceId: "essential" }), false);
    assert.strictEqual(tooClose({ date: "2026-11-20", time: "13:00", serviceId: "essential" }, deep), false);
    // Earlier job: Essential 06:00–08:00 leaves exactly 60 minutes before 09:00.
    assert.strictEqual(tooClose({ date: "2026-11-20", time: "06:00", serviceId: "essential" }, deep), false);
    assert.strictEqual(tooClose({ date: "2026-11-20", time: "06:30", serviceId: "essential" }, deep), true);
  });

  test("different days never conflict", () => {
    assert.strictEqual(
      tooClose(
        { date: "2026-11-20", time: "09:00", serviceId: "move-out" },
        { date: "2026-11-21", time: "09:30", serviceId: "deep" },
      ),
      false,
    );
  });

  test("findTravelConflict returns the job that is too close", () => {
    const jobs = [
      { id: "a", date: "2026-11-20", time: "09:00", serviceId: "deep" },
      { id: "b", date: "2026-11-20", time: "17:00", serviceId: "essential" },
    ];
    assert.strictEqual(findTravelConflict({ date: "2026-11-20", time: "12:30", serviceId: "essential" }, jobs).id, "a");
    assert.strictEqual(findTravelConflict({ date: "2026-11-20", time: "13:00", serviceId: "essential" }, jobs), null);
  });
});
