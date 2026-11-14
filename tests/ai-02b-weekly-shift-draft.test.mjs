import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createUserSession,
  getDatabase,
  getUserByEmail,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import {
  TRAVEL_MINUTES,
  WEEKLY_HOUR_CAP,
  hasEnoughTravelTime,
  jobHours,
  totalHours,
} from "../src/lib/shift-rules.ts";
import { NOTHING_TO_SCHEDULE, NO_CLEANER_FLAG, TRAVEL_TIME_MESSAGE, nextWeek } from "../src/lib/shift-draft.ts";
import { GET as draftGET, POST as draftPOST } from "../src/app/api/admin/shift-draft/route.ts";
import { PATCH as itemPATCH } from "../src/app/api/admin/shift-draft/items/[bookingId]/route.ts";
import { POST as publishPOST } from "../src/app/api/admin/shift-draft/publish/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const SERVICE_NAMES = { essential: "Essential clean", deep: "Deep clean", "move-out": "Move-in / move-out" };

/** Day `offset` of next week: 0 = Monday … 6 = Sunday. */
function day(offset) {
  return addDaysToDateString(nextWeek().weekStart, offset);
}

/** Inserts a booking directly (any time, so the travel rule can be tested with a 12:30 start). */
function addBooking(date, time, serviceId = "essential", acceptedBy = null) {
  const id = randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO bookings (id, name, email, service_id, service_name, price_cents, service_date,
         time_slot, address, created_at, accepted_by_id, accepted_by_name, accepted_at)
       VALUES (?, 'Alice Customer', 'customer@saiping.com', ?, ?, 8900, ?, ?, '12 Test Street', ?, ?, ?, ?)`,
    )
    .run(
      id,
      serviceId,
      SERVICE_NAMES[serviceId],
      date,
      time,
      new Date().toISOString(),
      acceptedBy?.id ?? null,
      acceptedBy?.name ?? null,
      acceptedBy ? new Date().toISOString() : null,
    );
  return id;
}

const SAI = { id: "cleaner-001", name: "Sai Ping Cleaner" }; // works every day
const MIA = { id: "cleaner-002", name: "Mia Cleaner" }; // works Monday–Friday

function adminCookie() {
  return `session_token=${createUserSession(getUserByEmail("admin@saiping.com").id).token}`;
}

function call(handler, { method = "GET", body, cookie = adminCookie(), bookingId } = {}) {
  const request = new Request("http://localhost/api/admin/shift-draft", {
    method,
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return bookingId === undefined
    ? handler(request)
    : handler(request, { params: Promise.resolve({ bookingId }) });
}

async function generate() {
  const res = await call(draftPOST, { method: "POST" });
  return { res, data: await res.json() };
}

function item(draft, bookingId) {
  return draft.items.find((entry) => entry.bookingId === bookingId);
}

function hoursOf(draft, cleanerId) {
  return draft.cleaners.find((cleaner) => cleaner.id === cleanerId).hours;
}

describe("AI-02B rules (stand-in for AI-02A)", () => {
  test("job length comes from the service: 2, 3 and 4 hours", () => {
    assert.equal(jobHours("essential"), 2);
    assert.equal(jobHours("deep"), 3);
    assert.equal(jobHours("move-out"), 4);
    assert.equal(jobHours("unknown"), 4);
    assert.equal(totalHours([{ serviceId: "deep" }, { serviceId: "essential" }]), 5);
  });

  test("a job starting less than 60 minutes after the previous one ends is blocked", () => {
    const deepAtNine = { date: "2026-12-04", time: "09:00", serviceId: "deep" }; // ends 12:00
    assert.equal(TRAVEL_MINUTES, 60);
    assert.equal(hasEnoughTravelTime([deepAtNine], { date: "2026-12-04", time: "12:30", serviceId: "essential" }), false);
  });

  test("exactly 60 minutes is allowed; the check works before and after", () => {
    const moveOutAtNine = { date: "2026-12-04", time: "09:00", serviceId: "move-out" }; // ends 13:00
    assert.equal(hasEnoughTravelTime([moveOutAtNine], { date: "2026-12-04", time: "14:00", serviceId: "essential" }), true);
    // The new job comes first and ends 11:00; the existing job starts 14:00.
    const later = { date: "2026-12-04", time: "14:00", serviceId: "essential" };
    assert.equal(hasEnoughTravelTime([later], { date: "2026-12-04", time: "09:00", serviceId: "essential" }), true);
    assert.equal(hasEnoughTravelTime([later], { date: "2026-12-04", time: "10:30", serviceId: "deep" }), false);
  });

  test("jobs on different days never clash", () => {
    const deep = { date: "2026-12-04", time: "09:00", serviceId: "deep" };
    assert.equal(hasEnoughTravelTime([deep], { date: "2026-12-05", time: "09:00", serviceId: "deep" }), true);
  });
});

describe("AI-02B Generate a weekly shift draft", () => {
  beforeEach(() => {
    resetDatabaseForTesting(new DatabaseSync(":memory:"));
    seedTestUsers();
  });

  afterEach(() => {
    resetDatabaseForTesting();
  });

  test("next week runs Monday to Sunday after this week", () => {
    const { weekStart, weekEnd } = nextWeek(new Date("2026-11-13T05:00:00Z")); // Friday in Bangkok
    assert.equal(weekStart, "2026-11-16");
    assert.equal(weekEnd, "2026-11-22");
    // Sunday 23:30 in Bangkok is still the old week.
    assert.equal(nextWeek(new Date("2026-11-15T16:30:00Z")).weekStart, "2026-11-16");
    // Monday 00:30 in Bangkok starts a new week.
    assert.equal(nextWeek(new Date("2026-11-16T17:30:00Z")).weekStart, "2026-11-23");
  });

  describe("AC 1: every unassigned next-week booking gets an eligible cleaner", () => {
    test("assigns each open job and leaves accepted jobs alone", async () => {
      const open1 = addBooking(day(0), "09:00");
      const open2 = addBooking(day(1), "14:00");
      const accepted = addBooking(day(2), "09:00", "essential", MIA);
      const thisWeek = addBooking(addDaysToDateString(day(0), -3), "09:00");

      const { res, data } = await generate();
      assert.equal(res.status, 201);
      assert.equal(data.draft.status, "draft");
      assert.deepEqual(data.draft.items.map((entry) => entry.bookingId).sort(), [open1, open2].sort());
      assert.ok(item(data.draft, open1).cleanerId);
      assert.ok(item(data.draft, open2).cleanerId);
      assert.equal(item(data.draft, accepted), undefined);
      assert.equal(item(data.draft, thisWeek), undefined);
      // Nothing is assigned for real until publishing.
      const row = getDatabase().prepare("SELECT accepted_by_id FROM bookings WHERE id = ?").get(open1);
      assert.equal(row.accepted_by_id, null);
    });

    test("work is shared fairly: the cleaner with fewer hours goes first", async () => {
      for (let i = 0; i < 4; i++) addBooking(day(i), "09:00");
      const { data } = await generate();
      assert.equal(hoursOf(data.draft, SAI.id), 4);
      assert.equal(hoursOf(data.draft, MIA.id), 4);
    });

    test("hours already accepted that week count towards fairness", async () => {
      addBooking(day(0), "09:00", "move-out", SAI);
      const a = addBooking(day(1), "09:00");
      const { data } = await generate();
      assert.equal(item(data.draft, a).cleanerId, MIA.id);
    });

    test("a weekend job only goes to a cleaner who works weekends", async () => {
      const saturday = addBooking(day(5), "09:00");
      const { data } = await generate();
      assert.equal(item(data.draft, saturday).cleanerId, SAI.id);
    });

    test("the travel-time rule is respected", async () => {
      // Sai has a deep clean 09:00–12:00 on Wednesday; a 12:30 job there must go to Mia.
      // Mia has more hours (4 vs 3), so only the travel rule sends the job to her.
      addBooking(day(2), "09:00", "deep", SAI);
      addBooking(day(0), "09:00", "move-out", MIA);
      const tight = addBooking(day(2), "12:30");
      const { data } = await generate();
      assert.equal(item(data.draft, tight).cleanerId, MIA.id);
    });
  });

  describe("AC 2 and edge cases: the 35-hour cap and not enough cleaners", () => {
    test("no cleaner goes over 35 hours; leftover jobs are flagged instead", async () => {
      getDatabase().prepare("UPDATE users SET status = 'suspended' WHERE cleaner_id = 'cleaner-002'").run();
      for (let d = 0; d < 7; d++) {
        addBooking(day(d), "09:00", "move-out");
        addBooking(day(d), "14:00", "move-out");
      }
      const { data } = await generate();
      assert.equal(WEEKLY_HOUR_CAP, 35);
      assert.ok(hoursOf(data.draft, SAI.id) <= 35);
      assert.equal(hoursOf(data.draft, SAI.id), 32);
      const flagged = data.draft.items.filter((entry) => entry.flag === NO_CLEANER_FLAG);
      assert.equal(flagged.length, 6);
      assert.ok(flagged.every((entry) => entry.cleanerId === null));
      assert.match(data.message, /6 jobs flagged "No cleaner available"/);
    });

    test("with no active cleaners at all, every job is flagged", async () => {
      getDatabase().prepare("UPDATE users SET status = 'suspended' WHERE role = 'cleaner'").run();
      const a = addBooking(day(0), "09:00");
      const { data } = await generate();
      assert.equal(item(data.draft, a).flag, NO_CLEANER_FLAG);
    });

    test("a week with nothing to schedule says so", async () => {
      addBooking(day(0), "09:00", "essential", MIA);
      const { res, data } = await generate();
      assert.equal(res.status, 200);
      assert.equal(data.message, NOTHING_TO_SCHEDULE);
      assert.equal(data.draft, null);
    });

    test("generating again replaces the unpublished draft", async () => {
      addBooking(day(0), "09:00");
      const first = (await generate()).data.draft;
      addBooking(day(1), "09:00");
      const second = (await generate()).data.draft;
      assert.notEqual(first.id, second.id);
      assert.equal(second.items.length, 2);
      const count = getDatabase().prepare("SELECT COUNT(*) AS n FROM shift_drafts").get().n;
      assert.equal(count, 1);
    });
  });

  describe("AC 3: totals per cleaner and changing a job's cleaner", () => {
    test("GET shows each cleaner's total hours", async () => {
      addBooking(day(0), "09:00", "deep");
      addBooking(day(1), "09:00", "essential");
      await generate();
      const data = await (await call(draftGET)).json();
      const total = data.draft.cleaners.reduce((sum, cleaner) => sum + cleaner.hours, 0);
      assert.equal(total, 5);
      assert.equal(data.draft.hourCap, 35);
    });

    test("GET before any draft returns draft: null and next week's dates", async () => {
      const data = await (await call(draftGET)).json();
      assert.equal(data.draft, null);
      assert.equal(data.week.weekStart, nextWeek().weekStart);
    });

    test("the admin changes a job to another eligible cleaner", async () => {
      const job = addBooking(day(0), "09:00");
      const draft = (await generate()).data.draft;
      const other = item(draft, job).cleanerId === SAI.id ? MIA : SAI;
      const res = await call(itemPATCH, { method: "PATCH", bookingId: job, body: { cleanerId: other.id } });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(item(data.draft, job).cleanerId, other.id);
      assert.equal(item(data.draft, job).cleanerName, other.name);
    });

    test("changing to a cleaner who doesn't work that day is refused", async () => {
      const saturday = addBooking(day(5), "09:00");
      await generate();
      const res = await call(itemPATCH, { method: "PATCH", bookingId: saturday, body: { cleanerId: MIA.id } });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /doesn't work on Saturdays/);
    });

    test("changing to a cleaner who would break the travel rule is refused", async () => {
      addBooking(day(2), "09:00", "deep", MIA);
      const tight = addBooking(day(2), "12:30");
      await generate();
      const res = await call(itemPATCH, { method: "PATCH", bookingId: tight, body: { cleanerId: MIA.id } });
      assert.equal(res.status, 409);
      assert.equal((await res.json()).error, TRAVEL_TIME_MESSAGE);
    });

    test("changing to a cleaner who would go over 35 hours is refused", async () => {
      // Mia already has 8 move-outs next week Mon–Fri (32 hours).
      for (let d = 0; d < 4; d++) {
        addBooking(day(d), "09:00", "move-out", MIA);
        addBooking(day(d), "14:00", "move-out", MIA);
      }
      const friday = addBooking(day(4), "09:00", "move-out");
      await generate();
      const res = await call(itemPATCH, { method: "PATCH", bookingId: friday, body: { cleanerId: MIA.id } });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /36 hours, over the 35-hour limit/);
    });

    test("a job can be set to no cleaner, and bad input is rejected", async () => {
      const job = addBooking(day(0), "09:00");
      await generate();
      const cleared = await call(itemPATCH, { method: "PATCH", bookingId: job, body: { cleanerId: null } });
      assert.equal(cleared.status, 200);
      assert.equal(item((await cleared.json()).draft, job).flag, NO_CLEANER_FLAG);
      assert.equal((await call(itemPATCH, { method: "PATCH", bookingId: job, body: {} })).status, 400);
      assert.equal((await call(itemPATCH, { method: "PATCH", bookingId: job, body: { cleanerId: 7 } })).status, 400);
      assert.equal((await call(itemPATCH, { method: "PATCH", bookingId: job, body: { cleanerId: "nobody" } })).status, 400);
      assert.equal((await call(itemPATCH, { method: "PATCH", bookingId: "not-in-draft", body: { cleanerId: SAI.id } })).status, 404);
    });

    test("changing a job with no draft gives 404", async () => {
      const job = addBooking(day(0), "09:00");
      const res = await call(itemPATCH, { method: "PATCH", bookingId: job, body: { cleanerId: SAI.id } });
      assert.equal(res.status, 404);
    });
  });

  describe("Publish draft", () => {
    test("publishing makes the assignments real", async () => {
      const a = addBooking(day(0), "09:00");
      const b = addBooking(day(1), "09:00");
      const draft = (await generate()).data.draft;
      const res = await call(publishPOST, { method: "POST" });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.assigned, 2);
      assert.deepEqual(data.skipped, []);
      assert.equal(data.draft.status, "published");
      for (const id of [a, b]) {
        const row = getDatabase().prepare("SELECT accepted_by_id, cleaner_id FROM bookings WHERE id = ?").get(id);
        assert.equal(row.accepted_by_id, item(draft, id).cleanerId);
        assert.equal(row.cleaner_id, item(draft, id).cleanerId);
      }
    });

    test("a job a cleaner accepted after the draft was made is skipped, not overwritten", async () => {
      const job = addBooking(day(0), "09:00");
      await generate();
      getDatabase()
        .prepare("UPDATE bookings SET accepted_by_id = 'cleaner-001', accepted_by_name = 'Sai Ping Cleaner' WHERE id = ?")
        .run(job);
      const data = await (await call(publishPOST, { method: "POST" })).json();
      assert.equal(data.assigned, 0);
      assert.equal(data.skipped.length, 1);
      assert.match(data.skipped[0].reason, /Already accepted/);
      const row = getDatabase().prepare("SELECT accepted_by_id FROM bookings WHERE id = ?").get(job);
      assert.equal(row.accepted_by_id, "cleaner-001");
    });

    test("a cancelled booking or a suspended cleaner is skipped", async () => {
      const gone = addBooking(day(0), "09:00");
      const other = addBooking(day(1), "09:00");
      const draft = (await generate()).data.draft;
      getDatabase().prepare("DELETE FROM bookings WHERE id = ?").run(gone);
      getDatabase()
        .prepare("UPDATE users SET status = 'suspended' WHERE cleaner_id = ?")
        .run(item(draft, other).cleanerId);
      const data = await (await call(publishPOST, { method: "POST" })).json();
      assert.equal(data.assigned, 0);
      assert.deepEqual(data.skipped.map((entry) => entry.reason).sort(), [
        "Booking cancelled",
        "The cleaner's account is no longer active",
      ]);
    });

    test("flagged jobs stay open requests after publishing", async () => {
      getDatabase().prepare("UPDATE users SET status = 'suspended' WHERE role = 'cleaner'").run();
      const job = addBooking(day(0), "09:00");
      await generate();
      getDatabase().prepare("UPDATE users SET status = 'active'").run();
      await call(publishPOST, { method: "POST" });
      const row = getDatabase().prepare("SELECT accepted_by_id FROM bookings WHERE id = ?").get(job);
      assert.equal(row.accepted_by_id, null);
    });

    test("publishing twice, or with no draft, is refused; a published draft can't be edited", async () => {
      assert.equal((await call(publishPOST, { method: "POST" })).status, 404);
      const job = addBooking(day(0), "09:00");
      await generate();
      assert.equal((await call(publishPOST, { method: "POST" })).status, 200);
      assert.equal((await call(publishPOST, { method: "POST" })).status, 409);
      const res = await call(itemPATCH, { method: "PATCH", bookingId: job, body: { cleanerId: null } });
      assert.equal(res.status, 409);
    });
  });

  describe("access", () => {
    test("signed out gives 401; customers and cleaners get 403 on every endpoint", async () => {
      const customer = `session_token=${createUserSession(getUserByEmail("customer@saiping.com").id).token}`;
      const cleaner = `session_token=${createUserSession(getUserByEmail("cleaner@saiping.com").id).token}`;
      assert.equal((await call(draftGET, { cookie: null })).status, 401);
      for (const cookie of [customer, cleaner]) {
        assert.equal((await call(draftGET, { cookie })).status, 403);
        assert.equal((await call(draftPOST, { method: "POST", cookie })).status, 403);
        assert.equal((await call(publishPOST, { method: "POST", cookie })).status, 403);
        assert.equal(
          (await call(itemPATCH, { method: "PATCH", cookie, bookingId: "x", body: { cleanerId: null } })).status,
          403,
        );
      }
    });
  });
});
