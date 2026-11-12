import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  bangkokDateString,
  getDayOfWeekFromDateString,
  localDateString,
} from "../src/lib/date-utils.ts";
import { getServiceStartTime } from "../src/lib/services.ts";
import {
  NO_SHOW_GRACE_MINUTES,
  REASSIGNED_ARRIVAL_MINUTES,
  acceptBookingRequest,
  checkInForVisit,
  createBooking,
  createUserSession,
  detectNoShows,
  getCleanerBookings,
  getDatabase,
  getNoShowAlerts,
  getUserByEmail,
  markBookingCompleted,
  reportRunningLate,
  resetDatabaseForTesting,
  resolveNoShowAlert,
} from "../src/lib/booking-store.ts";
import { GET as noShowsGET } from "../src/app/api/admin/no-shows/route.ts";
import { POST as resolvePOST } from "../src/app/api/admin/no-shows/[id]/resolve/route.ts";
import { POST as checkInPOST } from "../src/app/api/cleaner/bookings/[id]/check-in/route.ts";
import { POST as runningLatePOST } from "../src/app/api/cleaner/bookings/[id]/running-late/route.ts";
import { POST as completePOST } from "../src/app/api/cleaner/bookings/[id]/complete/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const MINUTE = 60 * 1000;
const CLEANER = "cleaner@saiping.com"; // cleaner-001, works every day
const CLEANER2 = "cleaner2@saiping.com"; // cleaner-002, Monday–Friday
const ADMIN = "admin@saiping.com";

/** A future date on the given weekday (0 = Sunday). */
function futureDateOn(weekday) {
  let date = addDaysToDateString(localDateString(new Date()), 7);
  while (getDayOfWeekFromDateString(date) !== weekday) date = addDaysToDateString(date, 1);
  return date;
}

const WEDNESDAY = () => futureDateOn(3);
const SATURDAY = () => futureDateOn(6);

function cleaner(email = CLEANER) {
  return getUserByEmail(email);
}

/** Books and accepts a job; returns the booking and its start time. */
function acceptedJob({ date = WEDNESDAY(), time = "09:00", by = CLEANER } = {}) {
  const result = createBooking({
    name: "Bob Client",
    email: "bob@example.com",
    serviceId: "essential",
    date,
    time,
    address: "456 Oak Avenue, Bangkok",
  });
  assert.equal(result.status, "created", JSON.stringify(result));
  const user = cleaner(by);
  assert.equal(acceptBookingRequest(result.booking.id, user.cleanerId, user.name).success, true);
  return { booking: result.booking, start: getServiceStartTime(date, time) };
}

const at = (start, minutes) => new Date(start.getTime() + minutes * MINUTE);

function tokenFor(email) {
  return createUserSession(getUserByEmail(email).id).token;
}

function post(handler, url, id, email, body) {
  const headers = email ? { cookie: `session_token=${tokenFor(email)}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  return handler(
    new Request(url, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("US-09: Cleaner no-show alert", () => {
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

  describe("AC1: when a no-show is triggered", () => {
    test("no alert before arrival time + grace; an alert once it passes", () => {
      const { booking, start } = acceptedJob();
      assert.equal(detectNoShows(at(start, NO_SHOW_GRACE_MINUTES - 1)), 0);
      assert.equal(getNoShowAlerts().open.length, 0);

      assert.equal(detectNoShows(at(start, NO_SHOW_GRACE_MINUTES)), 1);
      const [alert] = getNoShowAlerts().open;
      assert.equal(alert.bookingId, booking.id);
      assert.equal(alert.expectedBy, start.toISOString());
    });

    test("checking the same job again never creates a duplicate alert", () => {
      const { start } = acceptedJob();
      assert.equal(detectNoShows(at(start, 20)), 1);
      assert.equal(detectNoShows(at(start, 25)), 0);
      assert.equal(detectNoShows(at(start, 120)), 0);
      assert.equal(getNoShowAlerts().open.length, 1);
    });

    test("no alert when the cleaner checked in, or the job is completed", () => {
      const date = WEDNESDAY();
      const arrived = acceptedJob({ date, time: "09:00" });
      const done = acceptedJob({ date, time: "14:00" });
      assert.equal(checkInForVisit(arrived.booking.id, cleaner().cleanerId, at(arrived.start, 5)).status, "ok");
      markBookingCompleted(done.booking.id, cleaner().cleanerId);

      assert.equal(detectNoShows(at(done.start, 60)), 0);
    });

    test("jobs nobody accepted, and jobs on other days, are not checked", () => {
      const date = WEDNESDAY();
      createBooking({
        name: "Nobody's",
        email: "n@example.com",
        serviceId: "essential",
        date,
        time: "09:00",
        address: "1 Road",
      });
      const yesterday = acceptedJob({ date: addDaysToDateString(date, -1), time: "14:00" });

      assert.equal(detectNoShows(at(getServiceStartTime(date, "09:00"), 60)), 0);
      // Still "scheduled" the next day: a forgotten "complete", not a no-show.
      assert.equal(bangkokDateString(at(yesterday.start, 24 * 60)), date);
      assert.equal(detectNoShows(at(yesterday.start, 24 * 60)), 0);
    });

    test("a 'running late' update moves the deadline back", () => {
      const { booking, start } = acceptedJob();
      const result = reportRunningLate(booking.id, cleaner().cleanerId, 30, at(start, -10));
      assert.equal(result.status, "ok");
      assert.equal(result.expectedBy, at(start, 30).toISOString());

      assert.equal(detectNoShows(at(start, 30 + NO_SHOW_GRACE_MINUTES - 1)), 0);
      assert.equal(detectNoShows(at(start, 30 + NO_SHOW_GRACE_MINUTES)), 1);
      const [alert] = getNoShowAlerts().open;
      assert.equal(alert.lateMinutes, 30);
      assert.equal(alert.expectedBy, at(start, 30).toISOString());
    });

    test("only one late report, and the expected time never moves earlier", () => {
      const { booking, start } = acceptedJob();
      const id = cleaner().cleanerId;
      assert.equal(reportRunningLate(booking.id, id, 45, at(start, -5)).status, "ok");
      const again = reportRunningLate(booking.id, id, 15, at(start, 0));
      assert.equal(again.status, "already-reported");
      assert.equal(again.lateMinutes, 45);
      assert.equal(detectNoShows(at(start, 45 + NO_SHOW_GRACE_MINUTES - 1)), 0);
    });

    test("a replacement's late report counts from the time they were given", () => {
      const { booking, start } = acceptedJob();
      detectNoShows(at(start, 20));
      const [alert] = getNoShowAlerts().open;
      const t = at(start, 30);
      const second = cleaner(CLEANER2);
      resolveNoShowAlert(alert.id, { type: "reassign", cleanerId: second.cleanerId }, "Admin", t);

      const late = reportRunningLate(booking.id, second.cleanerId, 15, at(t, 10));
      assert.equal(late.status, "ok");
      assert.equal(late.expectedBy, at(t, REASSIGNED_ARRIVAL_MINUTES + 15).toISOString());
    });

    test("a late update is refused once the cleaner is already a no-show", () => {
      const { booking, start } = acceptedJob();
      const id = cleaner().cleanerId;
      assert.equal(reportRunningLate(booking.id, id, 15, at(start, NO_SHOW_GRACE_MINUTES)).status, "too-late");
      assert.equal(reportRunningLate(booking.id, id, 20, at(start, 0)).status, "invalid");
      assert.equal(reportRunningLate(booking.id, cleaner(CLEANER2).cleanerId, 15, at(start, 0)).status, "forbidden");
      assert.equal(reportRunningLate("missing", id, 15, at(start, 0)).status, "not-found");
    });

    test("check-in is closed after the day of the job", () => {
      const { booking, start } = acceptedJob();
      assert.equal(checkInForVisit(booking.id, cleaner().cleanerId, at(start, 24 * 60)).status, "past-day");
    });

    test("check-in opens an hour before arrival; a late check-in closes the alert", () => {
      const { booking, start } = acceptedJob();
      const id = cleaner().cleanerId;
      assert.equal(checkInForVisit(booking.id, id, at(start, -61)).status, "too-early");

      detectNoShows(at(start, 20));
      assert.equal(getNoShowAlerts().open.length, 1);

      const checkIn = checkInForVisit(booking.id, id, at(start, 25));
      assert.equal(checkIn.status, "ok");
      assert.equal(getNoShowAlerts().open.length, 0);
      const [resolved] = getNoShowAlerts().resolved;
      assert.equal(resolved.resolution, "cleaner-arrived");
      assert.equal(checkInForVisit(booking.id, id, at(start, 26)).status, "already-arrived");

      const job = getCleanerBookings(id).find((b) => b.id === booking.id);
      assert.equal(job.arrivedAt, checkIn.arrivedAt);
    });
  });

  describe("AC2: the alert contents", () => {
    test("shows booking ID, cleaner name, date, time and location", () => {
      const date = WEDNESDAY();
      const { booking, start } = acceptedJob({ date, time: "14:00" });
      detectNoShows(at(start, 30));
      const [alert] = getNoShowAlerts().open;
      assert.equal(alert.bookingId, booking.id);
      assert.equal(alert.cleanerName, cleaner().name);
      assert.equal(alert.date, date);
      assert.equal(alert.time, "14:00");
      assert.equal(alert.address, "456 Oak Avenue, Bangkok");
      assert.equal(alert.customerEmail, "bob@example.com");
      assert.equal(alert.status, "open");
    });
  });

  describe("AC3: resolving a no-show", () => {
    test("replacements are active cleaners who work that weekday, never the no-show cleaner", () => {
      const weekday = acceptedJob({ date: WEDNESDAY() });
      detectNoShows(at(weekday.start, 30));
      assert.deepEqual(
        getNoShowAlerts().open[0].replacements.map((c) => c.id),
        [cleaner(CLEANER2).cleanerId],
      );

      // cleaner2 doesn't work Saturdays, so nobody can take over.
      const saturday = acceptedJob({ date: SATURDAY() });
      detectNoShows(at(saturday.start, 30));
      const satAlert = getNoShowAlerts().open.find((a) => a.bookingId === saturday.booking.id);
      assert.deepEqual(satAlert.replacements, []);
    });

    test("reassigning moves the job to the new cleaner, who gets an hour to arrive", () => {
      const { booking, start } = acceptedJob();
      detectNoShows(at(start, 20));
      const [alert] = getNoShowAlerts().open;
      const now = at(start, 30);
      const other = cleaner(CLEANER2);

      const result = resolveNoShowAlert(alert.id, { type: "reassign", cleanerId: other.cleanerId }, "Admin", now);
      assert.equal(result.status, "ok");
      assert.equal(result.alert.reassignedToName, other.name);

      assert.ok(getCleanerBookings(other.cleanerId).some((b) => b.id === booking.id));
      assert.ok(!getCleanerBookings(cleaner().cleanerId).some((b) => b.id === booking.id));
      const [resolved] = getNoShowAlerts().resolved;
      assert.equal(resolved.resolution, "reassigned");
      assert.equal(resolved.reassignedToName, other.name);
      assert.equal(resolved.resolvedBy, "Admin");

      // The new cleaner isn't flagged straight away...
      const deadline = REASSIGNED_ARRIVAL_MINUTES + NO_SHOW_GRACE_MINUTES;
      assert.equal(detectNoShows(at(now, deadline - 1)), 0);
      // ...but gets their own alert if they don't turn up either.
      assert.equal(detectNoShows(at(now, deadline)), 1);
      assert.equal(getNoShowAlerts().open[0].cleanerId, other.cleanerId);
    });

    test("can't reassign to the no-show cleaner or someone off that day; can't resolve twice", () => {
      const { start } = acceptedJob({ date: SATURDAY() });
      detectNoShows(at(start, 20));
      const [alert] = getNoShowAlerts().open;
      for (const email of [CLEANER, CLEANER2]) {
        const result = resolveNoShowAlert(alert.id, { type: "reassign", cleanerId: cleaner(email).cleanerId }, "Admin");
        assert.equal(result.status, "invalid-cleaner");
      }

      assert.equal(resolveNoShowAlert(alert.id, { type: "resolve" }, "Admin").status, "ok");
      assert.equal(resolveNoShowAlert(alert.id, { type: "resolve" }, "Admin").status, "already-resolved");
      assert.equal(getNoShowAlerts().resolved[0].resolution, "resolved");
      assert.equal(resolveNoShowAlert("missing", { type: "resolve" }, "Admin").status, "not-found");
    });

    test("completing the job closes its open alert", () => {
      const { booking, start } = acceptedJob();
      detectNoShows(at(start, 20));
      assert.equal(getNoShowAlerts().open.length, 1);
      markBookingCompleted(booking.id, cleaner().cleanerId);
      assert.equal(getNoShowAlerts().open.length, 0);
      assert.equal(getNoShowAlerts().resolved[0].resolution, "job-completed");
    });

    test("a cleaner given the job back gets a new alert if they miss it again", () => {
      const { booking, start } = acceptedJob();
      const first = cleaner();
      const second = cleaner(CLEANER2);

      detectNoShows(at(start, 20));
      let [alert] = getNoShowAlerts().open;
      const t1 = at(start, 25);
      resolveNoShowAlert(alert.id, { type: "reassign", cleanerId: second.cleanerId }, "Admin", t1);

      detectNoShows(at(t1, REASSIGNED_ARRIVAL_MINUTES + NO_SHOW_GRACE_MINUTES));
      [alert] = getNoShowAlerts().open;
      assert.equal(alert.cleanerId, second.cleanerId);
      const t2 = at(t1, 80);
      resolveNoShowAlert(alert.id, { type: "reassign", cleanerId: first.cleanerId }, "Admin", t2);

      assert.equal(detectNoShows(at(t2, REASSIGNED_ARRIVAL_MINUTES + NO_SHOW_GRACE_MINUTES)), 1);
      [alert] = getNoShowAlerts().open;
      assert.equal(alert.cleanerId, first.cleanerId);
      assert.equal(alert.bookingId, booking.id);
    });

    test("the cleaner who lost the job can't complete it afterwards", async () => {
      const { booking, start } = acceptedJob();
      detectNoShows(at(start, 20));
      const [alert] = getNoShowAlerts().open;
      const second = cleaner(CLEANER2);
      resolveNoShowAlert(alert.id, { type: "reassign", cleanerId: second.cleanerId }, "Admin");

      assert.equal(
        markBookingCompleted(booking.id, cleaner().cleanerId, { requireAcceptedBy: cleaner().cleanerId }).status,
        "not-assigned",
      );
      const url = `http://localhost/api/cleaner/bookings/${booking.id}/complete`;
      assert.equal((await post(completePOST, url, booking.id, CLEANER)).status, 403);

      // Completion always records the currently assigned cleaner.
      assert.equal(markBookingCompleted(booking.id, cleaner().cleanerId).status, "completed");
      const row = getDatabase().prepare("SELECT cleaner_id FROM bookings WHERE id = ?").get(booking.id);
      assert.equal(row.cleaner_id, second.cleanerId);
    });
  });

  describe("API routes", () => {
    /** Moves a job to today (Bangkok) with a deadline already passed. */
    function overdueToday() {
      const { booking } = acceptedJob();
      getDatabase()
        .prepare("UPDATE bookings SET service_date = ?, arrive_by = ? WHERE id = ?")
        .run(bangkokDateString(), new Date(Date.now() - 30 * MINUTE).toISOString(), booking.id);
      return booking;
    }

    test("GET /api/admin/no-shows raises and lists alerts for the admin only", async () => {
      const booking = overdueToday();
      const get = (email) =>
        noShowsGET(
          new Request("http://localhost/api/admin/no-shows", {
            headers: email ? { cookie: `session_token=${tokenFor(email)}` } : {},
          }),
        );
      assert.equal((await get(null)).status, 401);
      assert.equal((await get(CLEANER)).status, 403);

      const res = await get(ADMIN);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.raised, 1);
      assert.equal(data.open[0].bookingId, booking.id);

      const again = await (await get(ADMIN)).json();
      assert.equal(again.raised, 0);
      assert.equal(again.open.length, 1);
    });

    test("POST resolve: admin only, validates the body, and reassigns", async () => {
      const { booking, start } = acceptedJob({ date: WEDNESDAY() });
      detectNoShows(at(start, 20));
      const [alert] = getNoShowAlerts().open;
      const url = `http://localhost/api/admin/no-shows/${alert.id}/resolve`;

      assert.equal((await post(resolvePOST, url, alert.id, CLEANER, { action: "resolve" })).status, 403);
      assert.equal((await post(resolvePOST, url, alert.id, ADMIN, { action: "reassign" })).status, 400);
      assert.equal((await post(resolvePOST, url, alert.id, ADMIN, "not json")).status, 400);
      const self = { action: "reassign", cleanerId: cleaner().cleanerId };
      assert.equal((await post(resolvePOST, url, alert.id, ADMIN, self)).status, 400);

      const other = cleaner(CLEANER2);
      const res = await post(resolvePOST, url, alert.id, ADMIN, { action: "reassign", cleanerId: other.cleanerId });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).message, `Job reassigned to ${other.name}. They have an hour to arrive.`);
      assert.ok(getCleanerBookings(other.cleanerId).some((b) => b.id === booking.id));

      assert.equal((await post(resolvePOST, url, alert.id, ADMIN, { action: "resolve" })).status, 409);
      assert.equal((await post(resolvePOST, "http://localhost/x", "missing", ADMIN, { action: "resolve" })).status, 404);
    });

    test("POST check-in and running-late: own jobs only, with clear errors", async () => {
      const { booking } = acceptedJob(); // more than an hour away
      const id = booking.id;
      const checkInUrl = `http://localhost/api/cleaner/bookings/${id}/check-in`;
      const lateUrl = `http://localhost/api/cleaner/bookings/${id}/running-late`;

      assert.equal((await post(checkInPOST, checkInUrl, id, null)).status, 401);
      assert.equal((await post(checkInPOST, checkInUrl, id, "customer@saiping.com")).status, 403);
      assert.equal((await post(checkInPOST, checkInUrl, id, CLEANER2)).status, 403);
      const early = await post(checkInPOST, checkInUrl, id, CLEANER);
      assert.equal(early.status, 409);
      assert.match((await early.json()).error, /one hour before/);

      assert.equal((await post(runningLatePOST, lateUrl, id, CLEANER, { minutes: 10 })).status, 400);
      const late = await post(runningLatePOST, lateUrl, id, CLEANER, { minutes: 45 });
      assert.equal(late.status, 200);
      assert.equal((await late.json()).lateMinutes, 45);
    });

    test("POST check-in is refused for a job on an earlier day", async () => {
      const booking = overdueToday();
      getDatabase()
        .prepare("UPDATE bookings SET service_date = ? WHERE id = ?")
        .run(addDaysToDateString(bangkokDateString(), -1), booking.id);
      const url = `http://localhost/api/cleaner/bookings/${booking.id}/check-in`;
      const res = await post(checkInPOST, url, booking.id, CLEANER);
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /only open on the day/);
    });
  });
});
