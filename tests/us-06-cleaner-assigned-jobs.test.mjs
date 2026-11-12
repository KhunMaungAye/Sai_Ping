import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { addDaysToDateString, localDateString } from "../src/lib/date-utils.ts";
import {
  CLEANER_CANCELLED_JOBS_LIMIT,
  acceptBookingRequest,
  cancelCustomerBooking,
  createBooking,
  createUserSession,
  getCleanerDashboardData,
  getDatabase,
  getUserByEmail,
  markBookingCompleted,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import { GET as cleanerBookingsGET } from "../src/app/api/cleaner/bookings/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const CLEANER = "cleaner@saiping.com"; // cleaner-001, works every day
const OTHER_CLEANER = "cleaner2@saiping.com"; // cleaner-002

function isWeekend(date) {
  return [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

/** A future date (days from today) that falls on a weekday, so both cleaners work it. */
function futureWeekday(minDays) {
  let date = addDaysToDateString(localDateString(new Date()), minDays);
  while (isWeekend(date)) date = addDaysToDateString(date, 1);
  return date;
}

/** The first weekday after `date`. */
function nextWeekday(date) {
  let next = addDaysToDateString(date, 1);
  while (isWeekend(next)) next = addDaysToDateString(next, 1);
  return next;
}

function book({ date, time = "09:00", email = "bob@example.com", name = "Bob Client", ...rest }) {
  const result = createBooking({
    name,
    email,
    serviceId: "essential",
    date,
    time,
    address: "456 Oak Avenue, Bangkok",
    ...rest,
  });
  assert.equal(result.status, "created", JSON.stringify(result));
  return result.booking;
}

function accept(bookingId, cleanerEmail = CLEANER) {
  const user = getUserByEmail(cleanerEmail);
  const result = acceptBookingRequest(bookingId, user.cleanerId, user.name);
  assert.equal(result.success, true, JSON.stringify(result));
}

async function getJobs(cleanerEmail = CLEANER) {
  const user = getUserByEmail(cleanerEmail);
  const token = createUserSession(user.id).token;
  return cleanerBookingsGET(
    new Request("http://localhost/api/cleaner/bookings", {
      headers: { cookie: `session_token=${token}` },
    }),
  );
}

describe("US-06: View assigned cleaning jobs", () => {
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

  test("AC1: the cleaner sees all the jobs they accepted, soonest first", async () => {
    const later = book({ date: futureWeekday(9), time: "14:00" });
    const sooner = book({ date: futureWeekday(3), time: "09:00" });
    accept(later.id);
    accept(sooner.id);

    const res = await getJobs();
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(
      data.bookings.map((job) => job.id),
      [sooner.id, later.id],
    );
  });

  test("AC2: each job shows date, time, location, service type, special instructions and status", async () => {
    const date = futureWeekday(4);
    const booking = book({ date, time: "14:00", specialInstructions: "Key under the mat. Cat inside." });
    accept(booking.id);

    const job = (await (await getJobs()).json()).bookings[0];
    assert.equal(job.date, date);
    assert.equal(job.time, "14:00");
    assert.equal(job.address, "456 Oak Avenue, Bangkok");
    assert.equal(job.serviceName, "Essential clean");
    assert.equal(job.specialInstructions, "Key under the mat. Cat inside.");
    assert.equal(job.status, "scheduled");
    assert.equal(job.statusLabel, "Scheduled");
  });

  test("AC3: the current status of each job is shown (scheduled, completed)", async () => {
    const done = book({ date: futureWeekday(3) });
    const open = book({ date: futureWeekday(3), time: "14:00" });
    accept(done.id);
    accept(open.id);
    markBookingCompleted(done.id, getUserByEmail(CLEANER).cleanerId);

    const jobs = (await (await getJobs()).json()).bookings;
    const byId = Object.fromEntries(jobs.map((job) => [job.id, job]));
    assert.equal(byId[done.id].status, "completed");
    assert.equal(byId[done.id].statusLabel, "Completed");
    assert.equal(byId[open.id].status, "scheduled");
  });

  test("AC3: a job the customer cancels shows as 'Cancelled by customer' instead of vanishing", async () => {
    const date = futureWeekday(5);
    const kept = book({ date, time: "09:00" });
    const cancelled = book({ date, time: "14:00", email: "carol@example.com", name: "Carol Client" });
    accept(kept.id);
    accept(cancelled.id);
    assert.equal(cancelCustomerBooking(cancelled.id, "carol@example.com").status, "cancelled");

    const data = await (await getJobs()).json();
    assert.deepEqual(data.bookings.map((job) => job.id), [kept.id]);
    assert.equal(data.cancelledJobs.length, 1);
    const job = data.cancelledJobs[0];
    assert.equal(job.id, cancelled.id);
    assert.equal(job.status, "cancelled");
    assert.equal(job.statusLabel, "Cancelled by customer");
    assert.equal(job.customerName, "Carol Client");
    assert.equal(job.date, date);
    assert.equal(job.time, "14:00");
    assert.equal(job.address, "456 Oak Avenue, Bangkok");
  });

  test("a cancelled job that was never accepted, or that another cleaner accepted, is not shown", async () => {
    const date = futureWeekday(5);
    const unaccepted = book({ date, time: "09:00" });
    const others = book({ date, time: "14:00" });
    accept(others.id, OTHER_CLEANER);
    cancelCustomerBooking(unaccepted.id, "bob@example.com");
    cancelCustomerBooking(others.id, "bob@example.com");

    assert.deepEqual((await (await getJobs()).json()).cancelledJobs, []);
    const otherData = await (await getJobs(OTHER_CLEANER)).json();
    assert.deepEqual(otherData.cancelledJobs.map((job) => job.id), [others.id]);
  });

  test("a cleaner never sees another cleaner's jobs or unaccepted requests in their list", async () => {
    const mine = book({ date: futureWeekday(3) });
    const theirs = book({ date: futureWeekday(3), time: "14:00" });
    const open = book({ date: futureWeekday(10) });
    accept(mine.id);
    accept(theirs.id, OTHER_CLEANER);

    const data = await (await getJobs()).json();
    assert.deepEqual(data.bookings.map((job) => job.id), [mine.id]);
    assert.ok(!data.bookings.some((job) => job.id === open.id));
  });

  test("a cleaner with no accepted jobs gets empty lists", async () => {
    const data = await (await getJobs()).json();
    assert.deepEqual(data.bookings, []);
    assert.deepEqual(data.cancelledJobs, []);
  });

  test("only the soonest cancelled jobs are listed, up to the cap", async () => {
    // Each job gets its own slot: 09:00 and 14:00 on consecutive weekdays.
    const total = CLEANER_CANCELLED_JOBS_LIMIT + 5;
    const firstDate = futureWeekday(3);
    let date = firstDate;
    for (let made = 0; made < total; made += 1) {
      const time = made % 2 === 0 ? "09:00" : "14:00";
      const booking = book({ date, time });
      accept(booking.id);
      assert.equal(cancelCustomerBooking(booking.id, "bob@example.com").status, "cancelled");
      if (time === "14:00") date = nextWeekday(date);
    }

    const { cancelledJobs } = await (await getJobs()).json();
    assert.equal(cancelledJobs.length, CLEANER_CANCELLED_JOBS_LIMIT);
    const keys = cancelledJobs.map((job) => `${job.date} ${job.time}`);
    assert.deepEqual(keys, [...keys].sort(), "soonest first");
    assert.equal(cancelledJobs[0].date, firstDate);
  });

  test("dashboard lists are read in one transaction that is always closed", () => {
    const booking = book({ date: futureWeekday(3) });
    accept(booking.id);
    const cleanerId = getUserByEmail(CLEANER).cleanerId;

    const data = getCleanerDashboardData(cleanerId);
    assert.deepEqual(data.bookings.map((job) => job.id), [booking.id]);
    assert.deepEqual(data.cancelledJobs, []);
    // A new transaction can start, so the read transaction was committed.
    getDatabase().exec("BEGIN IMMEDIATE; COMMIT;");

    // If a read fails, the transaction is rolled back and the error is passed on.
    getDatabase().exec("DROP TABLE cancelled_bookings;");
    assert.throws(() => getCleanerDashboardData(cleanerId));
    getDatabase().exec("BEGIN IMMEDIATE; COMMIT;");
  });

  test("the API returns 500 (not empty lists) when a read fails", async () => {
    getDatabase().exec("DROP TABLE cancelled_bookings;");
    const res = await getJobs();
    assert.equal(res.status, 500);
    assert.ok((await res.json()).error);
  });

  test("401 when signed out, 403 for a customer", async () => {
    const signedOut = await cleanerBookingsGET(new Request("http://localhost/api/cleaner/bookings"));
    assert.equal(signedOut.status, 401);

    const customer = getUserByEmail("customer@saiping.com");
    const token = createUserSession(customer.id).token;
    const asCustomer = await cleanerBookingsGET(
      new Request("http://localhost/api/cleaner/bookings", {
        headers: { cookie: `session_token=${token}` },
      }),
    );
    assert.equal(asCustomer.status, 403);
  });
});
