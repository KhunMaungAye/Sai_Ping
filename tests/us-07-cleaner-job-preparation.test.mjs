import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  acceptBookingRequest,
  addDaysToDateString,
  createBooking,
  createUserSession,
  getDatabase,
  getDayOfWeekFromDateString,
  getUserByEmail,
  localDateString,
  markBookingCompleted,
  resetDatabaseForTesting,
  SERVICES,
} from "../src/lib/booking-store.ts";
import { addHours, jobPreparation, SERVICE_SPECS } from "../src/lib/service-specs.ts";
import { GET as jobGET } from "../src/app/api/cleaner/bookings/[id]/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const CLEANER = "cleaner@saiping.com";
const OTHER_CLEANER = "cleaner2@saiping.com";

/** Next Monday–Friday, so both test cleaners work that day. */
function nextWeekday() {
  let date = addDaysToDateString(localDateString(), 1);
  while ([0, 6].includes(getDayOfWeekFromDateString(date))) date = addDaysToDateString(date, 1);
  return date;
}

function cookieFor(email) {
  return `session_token=${createUserSession(getUserByEmail(email).id).token}`;
}

function book({ serviceId = "deep", time = "09:00", note = "Door code 1234" } = {}) {
  const result = createBooking({
    name: "Alice Customer",
    email: "customer@saiping.com",
    serviceId,
    date: nextWeekday(),
    time,
    address: "12 Sukhumvit Soi 24, Bangkok",
    specialInstructions: note,
  });
  assert.strictEqual(result.status, "created");
  return result.booking;
}

function accept(bookingId, email = CLEANER) {
  const cleaner = getUserByEmail(email);
  const result = acceptBookingRequest(bookingId, cleaner.cleanerId || cleaner.id, cleaner.name);
  assert.strictEqual(result.success, true);
}

function getJob(id, email = CLEANER) {
  const headers = email ? { cookie: cookieFor(email) } : {};
  return jobGET(new Request(`http://localhost/api/cleaner/bookings/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

describe("US-07 cleaner views schedule and service details", () => {
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

  test("AC1: the cleaner gets preparation details for a job they accepted", async () => {
    const booking = book();
    accept(booking.id);
    const res = await getJob(booking.id);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("cache-control"), "no-store");
    const { job, preparation } = await res.json();
    assert.ok(job && preparation);
    assert.strictEqual(job.customerName, "Alice Customer");
    assert.strictEqual(job.specialInstructions, "Door code 1234");
  });

  test("AC2: the details include the schedule (date, arrival, estimated finish, length)", async () => {
    const booking = book({ serviceId: "deep", time: "09:00" });
    accept(booking.id);
    const { job, preparation } = await (await getJob(booking.id)).json();
    assert.strictEqual(job.date, booking.date);
    assert.strictEqual(preparation.start, "09:00");
    assert.strictEqual(preparation.end, "12:00");
    assert.strictEqual(preparation.length, "3 hours");
  });

  test("AC2: the details include the required service specs (what's included and what to bring)", async () => {
    const booking = book({ serviceId: "move-out", time: "14:00" });
    accept(booking.id);
    const { preparation } = await (await getJob(booking.id)).json();
    assert.strictEqual(preparation.serviceName, "Move-in / move-out");
    assert.deepStrictEqual(preparation.includes, [...SERVICE_SPECS["move-out"].includes]);
    assert.deepStrictEqual(preparation.bring, [...SERVICE_SPECS["move-out"].bring]);
    assert.strictEqual(preparation.end, "18:00");
  });

  test("AC3: the details match the cleaner's assigned booking", async () => {
    const booking = book({ serviceId: "essential", time: "14:00", note: "Cat inside" });
    accept(booking.id);
    const { job } = await (await getJob(booking.id)).json();
    assert.strictEqual(job.id, booking.id);
    assert.strictEqual(job.serviceId, "essential");
    assert.strictEqual(job.serviceName, "Essential clean");
    assert.strictEqual(job.time, "14:00");
    assert.strictEqual(job.address, "12 Sukhumvit Soi 24, Bangkok");
    assert.strictEqual(job.specialInstructions, "Cat inside");
    assert.strictEqual(job.isRecurring, false);
  });

  test("AC3: a job accepted by another cleaner is not found", async () => {
    const booking = book();
    accept(booking.id, OTHER_CLEANER);
    const res = await getJob(booking.id, CLEANER);
    assert.strictEqual(res.status, 404);
    assert.strictEqual((await res.json()).error, "Job not found. It may not be assigned to you.");
  });

  test("AC3: an open request nobody accepted yet is not found", async () => {
    const booking = book();
    const res = await getJob(booking.id);
    assert.strictEqual(res.status, 404);
  });

  test("Edge: a job with no special instructions returns null for the note", async () => {
    const booking = book({ note: "" });
    accept(booking.id);
    const { job } = await (await getJob(booking.id)).json();
    assert.strictEqual(job.specialInstructions, null);
  });

  test("Edge: a completed job's details stay available to its cleaner", async () => {
    const booking = book();
    accept(booking.id);
    const cleaner = getUserByEmail(CLEANER);
    markBookingCompleted(booking.id, cleaner.cleanerId, { requireAcceptedBy: cleaner.cleanerId });
    const res = await getJob(booking.id);
    assert.strictEqual(res.status, 200);
  });

  test("Edge: an unknown job id is not found", async () => {
    const res = await getJob("does-not-exist");
    assert.strictEqual(res.status, 404);
  });

  test("Access: signed out gets 401", async () => {
    const booking = book();
    accept(booking.id);
    assert.strictEqual((await getJob(booking.id, null)).status, 401);
  });

  test("Access: customers and admins get 403", async () => {
    const booking = book();
    accept(booking.id);
    for (const email of ["customer@saiping.com", "admin@saiping.com"]) {
      assert.strictEqual((await getJob(booking.id, email)).status, 403, email);
    }
  });
});

describe("US-07 service specs", () => {
  test("every service has a spec whose length matches its advertised duration", () => {
    for (const service of SERVICES) {
      const spec = SERVICE_SPECS[service.id];
      assert.ok(spec, service.id);
      assert.strictEqual(`${spec.hours} hours`, service.duration);
      assert.ok(spec.includes.length > 0 && spec.bring.length > 0);
    }
  });

  test("addHours works out the finish time", () => {
    assert.strictEqual(addHours("09:00", 2), "11:00");
    assert.strictEqual(addHours("14:00", 4), "18:00");
    assert.strictEqual(addHours("09:30", 3), "12:30");
  });

  test("jobPreparation combines the schedule and the specs", () => {
    assert.deepStrictEqual(jobPreparation("essential", "09:00"), {
      serviceName: "Essential clean",
      start: "09:00",
      end: "11:00",
      length: "2 hours",
      includes: SERVICE_SPECS.essential.includes,
      bring: SERVICE_SPECS.essential.bring,
    });
  });
});
