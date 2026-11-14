import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  adminUpdateBooking,
  createBooking,
  createUserSession,
  getAdminBooking,
  getAdminBookingChanges,
  getDatabase,
  getDayOfWeekFromDateString,
  getUserByEmail,
  resetDatabaseForTesting,
  submitBookingRating,
} from "../src/lib/booking-store.ts";
import { searchAdminBookings } from "../src/lib/admin-bookings.ts";
import { bangkokDateString } from "../src/lib/date-utils.ts";
import { GET as detailGET, PATCH as detailPATCH } from "../src/app/api/admin/bookings/[id]/route.ts";
import { POST as acceptPOST } from "../src/app/api/cleaner/bookings/[id]/accept/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const ADMIN = { id: "user-admin-001", name: "System Administrator" };

let dayCounter = 0;
/** A fresh upcoming Monday–Friday date each call, so both seeded cleaners work it. */
function nextWeekday() {
  let date = addDaysToDateString(bangkokDateString(), 2 + dayCounter);
  while (true) {
    const day = getDayOfWeekFromDateString(date);
    dayCounter += 1;
    if (day >= 1 && day <= 5) return date;
    date = addDaysToDateString(date, 1);
  }
}

/** The next Saturday after `date` (only cleaner@ works weekends). */
function saturdayAfter(date) {
  let next = addDaysToDateString(date, 1);
  while (getDayOfWeekFromDateString(next) !== 6) next = addDaysToDateString(next, 1);
  return next;
}

function sessionCookie(email) {
  const user = getUserByEmail(email);
  assert.ok(user, `seed user ${email} exists`);
  return `session_token=${createUserSession(user.id).token}`;
}

function book(date, time = "09:00", extra = {}) {
  const result = createBooking({
    name: "Alice Customer",
    email: "customer@saiping.com",
    serviceId: "essential",
    date,
    time,
    address: "12 Test Street, Bangkok",
    ...extra,
  });
  assert.equal(result.status, "created", `booking ${date} ${time} created`);
  return result.booking.id;
}

/** Marks a booking as accepted by a cleaner directly (works for past dates too). */
function assign(id, cleanerId = "cleaner-002", cleanerName = "Mia Cleaner") {
  getDatabase()
    .prepare(
      "UPDATE bookings SET accepted_by_id = ?, accepted_by_name = ?, accepted_at = ? WHERE id = ?",
    )
    .run(cleanerId, cleanerName, new Date().toISOString(), id);
}

function patch(id, body, cookie = sessionCookie("admin@saiping.com")) {
  return detailPATCH(
    new Request(`http://localhost/api/admin/bookings/${id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function get(id, cookie = sessionCookie("admin@saiping.com")) {
  return detailGET(
    new Request(`http://localhost/api/admin/bookings/${id}`, { headers: cookie ? { cookie } : {} }),
    { params: Promise.resolve({ id }) },
  );
}

describe("US-08 Manage customer bookings", () => {
  beforeEach(() => {
    resetDatabaseForTesting(new DatabaseSync(":memory:"));
    seedTestUsers();
    dayCounter = 0;
  });

  afterEach(() => {
    resetDatabaseForTesting();
  });

  describe("search (AC 1)", () => {
    const rows = [
      { id: "6b64bf66-aaaa", name: "Alice Customer", email: "alice@example.com", address: "12 Sukhumvit Soi 11", serviceName: "Essential clean", acceptedByName: "Mia Cleaner" },
      { id: "0c1d2e3f-bbbb", name: "Bob Tan", email: "bob@example.com", address: "88 Silom Road", serviceName: "Deep clean", acceptedByName: null },
    ];

    test("matches the reference with or without # and in any case", () => {
      assert.deepEqual(searchAdminBookings(rows, "6B64BF66").map((r) => r.name), ["Alice Customer"]);
      assert.deepEqual(searchAdminBookings(rows, "#6b64").map((r) => r.name), ["Alice Customer"]);
    });

    test("matches customer name, email, address, service and cleaner", () => {
      assert.equal(searchAdminBookings(rows, "bob tan").length, 1);
      assert.equal(searchAdminBookings(rows, "ALICE@EXAMPLE").length, 1);
      assert.equal(searchAdminBookings(rows, "silom").length, 1);
      assert.equal(searchAdminBookings(rows, "deep").length, 1);
      assert.equal(searchAdminBookings(rows, "mia").length, 1);
    });

    test("empty or blank text shows everything; no match gives an empty list", () => {
      assert.equal(searchAdminBookings(rows, "   ").length, 2);
      assert.equal(searchAdminBookings(rows, "nobody").length, 0);
    });
  });

  describe("GET /api/admin/bookings/[id] (AC 1)", () => {
    test("admin gets the full booking and an empty change history", async () => {
      const id = book(nextWeekday(), "09:00", { specialInstructions: "Cat is friendly" });
      const res = await get(id);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.booking.id, id);
      assert.equal(data.booking.email, "customer@saiping.com");
      assert.equal(data.booking.specialInstructions, "Cat is friendly");
      assert.deepEqual(data.changes, []);
    });

    test("unknown booking gives 404", async () => {
      const res = await get("missing-id");
      assert.equal(res.status, 404);
    });

    test("signed out gives 401; customer and cleaner give 403", async () => {
      const id = book(nextWeekday());
      assert.equal((await get(id, null)).status, 401);
      assert.equal((await get(id, sessionCookie("customer@saiping.com"))).status, 403);
      assert.equal((await get(id, sessionCookie("cleaner@saiping.com"))).status, 403);
    });
  });

  describe("updating details (AC 1)", () => {
    test("admin updates address and special instructions; the change is logged", async () => {
      const id = book(nextWeekday());
      const res = await patch(id, { address: "  99 New Road,   Bangkok ", specialInstructions: "Gate code 1234" });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.booking.address, "99 New Road, Bangkok");
      assert.equal(data.booking.specialInstructions, "Gate code 1234");
      assert.match(data.message, /Address updated; Special instructions updated/);

      const saved = getAdminBooking(id);
      assert.equal(saved.address, "99 New Road, Bangkok");
      const history = getAdminBookingChanges(id);
      assert.equal(history.length, 1);
      assert.equal(history[0].adminName, "System Administrator");
    });

    test("only the targeted booking changes", async () => {
      const date = nextWeekday();
      const a = book(date, "09:00");
      const b = book(date, "14:00");
      await patch(a, { address: "1 Changed Lane" });
      assert.equal(getAdminBooking(a).address, "1 Changed Lane");
      assert.equal(getAdminBooking(b).address, "12 Test Street, Bangkok");
    });

    test("empty special instructions clear the note", async () => {
      const id = book(nextWeekday(), "09:00", { specialInstructions: "Old note" });
      const data = await (await patch(id, { specialInstructions: "   " })).json();
      assert.equal(data.booking.specialInstructions, null);
      assert.match(data.message, /Special instructions cleared/);
    });

    test("too short or too long address, and over-long instructions, give 400 and change nothing", async () => {
      const id = book(nextWeekday());
      assert.equal((await patch(id, { address: "abc" })).status, 400);
      assert.equal((await patch(id, { address: "x".repeat(301) })).status, 400);
      assert.equal((await patch(id, { address: 42 })).status, 400);
      assert.equal((await patch(id, { specialInstructions: "y".repeat(251) })).status, 400);
      assert.equal(getAdminBooking(id).address, "12 Test Street, Bangkok");
      assert.equal(getAdminBookingChanges(id).length, 0);
    });

    test("a bad field in the same request stops every change (all or nothing)", async () => {
      const id = book(nextWeekday());
      const res = await patch(id, { address: "77 Fine Road", status: "cancelled" });
      assert.equal(res.status, 400);
      assert.equal(getAdminBooking(id).address, "12 Test Street, Bangkok");
    });

    test("sending the same values reports nothing changed and logs nothing", async () => {
      const id = book(nextWeekday());
      const data = await (await patch(id, { address: "12 Test Street, Bangkok" })).json();
      assert.equal(data.message, "Nothing changed.");
      assert.equal(getAdminBookingChanges(id).length, 0);
    });

    test("invalid JSON, an empty body and unknown fields give 400", async () => {
      const id = book(nextWeekday());
      assert.equal((await patch(id, "{not json")).status, 400);
      assert.equal((await patch(id, {})).status, 400);
      assert.equal((await patch(id, { price: 1 })).status, 400);
      assert.equal((await patch(id, [1, 2])).status, 400);
    });

    test("unknown booking gives 404; non-admins can't update", async () => {
      assert.equal((await patch("missing", { address: "12 Some Road" })).status, 404);
      const id = book(nextWeekday());
      assert.equal((await patch(id, { address: "12 Some Road" }, sessionCookie("customer@saiping.com"))).status, 403);
      assert.equal((await patch(id, { address: "12 Some Road" }, sessionCookie("cleaner2@saiping.com"))).status, 403);
    });
  });

  describe("moving a booking to another date or arrival window (AC 1)", () => {
    test("admin moves an open booking to a free slot", async () => {
      const id = book(nextWeekday());
      const target = nextWeekday();
      const res = await patch(id, { date: target, time: "14:00" });
      assert.equal(res.status, 200);
      const saved = getAdminBooking(id);
      assert.equal(saved.date, target);
      assert.equal(saved.time, "14:00");
      assert.match(getAdminBookingChanges(id)[0].summary, /^Moved from/);
    });

    test("moving into a booked slot gives 409", async () => {
      const date = nextWeekday();
      const id = book(date, "09:00");
      book(date, "14:00");
      const res = await patch(id, { time: "14:00" });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /already booked/);
    });

    test("a past date, a bad date or a bad slot gives 400", async () => {
      const id = book(nextWeekday());
      assert.equal((await patch(id, { date: addDaysToDateString(bangkokDateString(), -1) })).status, 400);
      assert.equal((await patch(id, { date: "2026-02-30" })).status, 400);
      assert.equal((await patch(id, { date: "next friday" })).status, 400);
      assert.equal((await patch(id, { time: "11:00" })).status, 400);
    });

    test("an accepted job can't move to a day its cleaner doesn't work", async () => {
      const date = nextWeekday();
      const id = book(date);
      const accept = await acceptPOST(
        new Request(`http://localhost/api/cleaner/bookings/${id}/accept`, {
          method: "POST",
          headers: { cookie: sessionCookie("cleaner2@saiping.com") },
        }),
        { params: Promise.resolve({ id }) },
      );
      assert.equal(accept.status, 200);
      const res = await patch(id, { date: saturdayAfter(date) });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /assigned cleaner doesn't work/);
    });

    test("an open job can move to a weekend because another cleaner works then", async () => {
      const date = nextWeekday();
      const id = book(date);
      const res = await patch(id, { date: saturdayAfter(date) });
      assert.equal(res.status, 200);
    });

    test("no active cleaner on the new day gives 409", async () => {
      getDatabase().exec("UPDATE cleaners SET available_days = '1,2,3,4,5'");
      const date = nextWeekday();
      const id = book(date);
      const res = await patch(id, { date: saturdayAfter(date) });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /No cleaner works/);
    });

    test("a visit the cleaner has checked in to can't be moved", async () => {
      const id = book(nextWeekday());
      assign(id);
      getDatabase().prepare("UPDATE bookings SET arrived_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      const res = await patch(id, { date: nextWeekday() });
      assert.equal(res.status, 409);
    });

    test("moving clears the late report and closes an open no-show alert", () => {
      const date = nextWeekday();
      const id = book(date);
      assign(id);
      const db = getDatabase();
      db.prepare("UPDATE bookings SET late_minutes = 30, arrive_by = ? WHERE id = ?").run(new Date().toISOString(), id);
      db.prepare(
        `INSERT INTO no_show_alerts (id, booking_id, cleaner_id, cleaner_name, expected_by, detected_at)
         VALUES ('alert-1', ?, 'cleaner-002', 'Mia Cleaner', ?, ?)`,
      ).run(id, new Date().toISOString(), new Date().toISOString());

      const result = adminUpdateBooking(id, { time: "14:00" }, ADMIN);
      assert.equal(result.status, "updated");
      const row = db.prepare("SELECT late_minutes, arrive_by FROM bookings WHERE id = ?").get(id);
      assert.equal(row.late_minutes, null);
      assert.equal(row.arrive_by, null);
      const alert = db.prepare("SELECT status, resolution FROM no_show_alerts WHERE id = 'alert-1'").get();
      assert.equal(alert.status, "resolved");
      assert.equal(alert.resolution, "resolved");
    });
  });

  describe("service status (AC 2 and 3)", () => {
    function pastBooking() {
      const date = addDaysToDateString(bangkokDateString(), -2);
      return book(date, "09:00");
    }

    test("admin marks a past, accepted visit completed; the cleaner is recorded", async () => {
      const id = pastBooking();
      assign(id);
      const res = await patch(id, { status: "completed" });
      assert.equal(res.status, 200);
      const saved = getAdminBooking(id);
      assert.equal(saved.status, "completed");
      assert.equal(saved.statusLabel, "Completed");
      assert.equal(saved.cleanerId, "cleaner-002");
      assert.match(getAdminBookingChanges(id)[0].summary, /Status changed to Completed/);
    });

    test("completing closes an open no-show alert as job-completed", () => {
      const id = pastBooking();
      assign(id);
      getDatabase()
        .prepare(
          `INSERT INTO no_show_alerts (id, booking_id, cleaner_id, cleaner_name, expected_by, detected_at)
           VALUES ('alert-2', ?, 'cleaner-002', 'Mia Cleaner', ?, ?)`,
        )
        .run(id, new Date().toISOString(), new Date().toISOString());
      adminUpdateBooking(id, { status: "completed" }, ADMIN);
      const alert = getDatabase().prepare("SELECT resolution FROM no_show_alerts WHERE id = 'alert-2'").get();
      assert.equal(alert.resolution, "job-completed");
    });

    test("a booking no cleaner accepted can't be completed", async () => {
      const id = pastBooking();
      const res = await patch(id, { status: "completed" });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /No cleaner has accepted/);
    });

    test("a visit that hasn't started can't be completed", async () => {
      const id = book(nextWeekday());
      assign(id);
      const res = await patch(id, { status: "completed" });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /before it starts/);
    });

    test("admin can undo a completion by mistake (back to Scheduled)", async () => {
      const id = pastBooking();
      assign(id);
      await patch(id, { status: "completed" });
      const res = await patch(id, { status: "scheduled" });
      assert.equal(res.status, 200);
      assert.equal(getAdminBooking(id).status, "scheduled");
      assert.equal(getAdminBookingChanges(id).length, 2);
    });

    test("a rated booking stays Completed", async () => {
      const id = pastBooking();
      assign(id);
      await patch(id, { status: "completed" });
      submitBookingRating(id, 5, "Great");
      const res = await patch(id, { status: "scheduled" });
      assert.equal(res.status, 409);
      assert.equal(getAdminBooking(id).status, "completed");
    });

    test("a completed booking can't be moved, even while editing its status", async () => {
      const id = pastBooking();
      assign(id);
      await patch(id, { status: "completed" });
      assert.equal((await patch(id, { date: nextWeekday() })).status, 409);
    });

    test("an unknown status gives 400", async () => {
      const id = book(nextWeekday());
      assert.equal((await patch(id, { status: "done" })).status, 400);
    });
  });
});
