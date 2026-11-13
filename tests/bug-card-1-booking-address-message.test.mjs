import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createUserSession,
  getDatabase,
  getDayOfWeekFromDateString,
  getUserByEmail,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import {
  ADDRESS_REQUIRED_MESSAGE,
  DATE_REQUIRED_MESSAGE,
  TIME_REQUIRED_MESSAGE,
  findBookingFormProblem,
} from "../src/lib/booking-form.ts";
import { POST as bookingsPOST } from "../src/app/api/bookings/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const TODAY = "2026-11-13";
const filled = { date: "2026-11-20", time: "14:00", address: "12 Sukhumvit Soi 24, Bangkok", minimumDate: TODAY };

// Bug Card 1 (BH-04): "Booking form gives no message when the address is empty"
describe("Bug Card 1: booking form names the missing field", () => {
  test("Bug steps: Essential, One-Time, a date, 2:00 PM, empty address -> the address message", () => {
    assert.deepStrictEqual(findBookingFormProblem({ ...filled, address: "" }), {
      field: "address",
      message: "Please enter your cleaning address.",
    });
  });

  test("an address of only spaces counts as empty", () => {
    assert.strictEqual(findBookingFormProblem({ ...filled, address: "   " }).message, ADDRESS_REQUIRED_MESSAGE);
  });

  test("a missing time or date also gets its own message", () => {
    assert.deepStrictEqual(findBookingFormProblem({ ...filled, time: "" }), {
      field: "time",
      message: TIME_REQUIRED_MESSAGE,
    });
    assert.deepStrictEqual(findBookingFormProblem({ ...filled, date: "" }), {
      field: "date",
      message: DATE_REQUIRED_MESSAGE,
    });
    assert.strictEqual(findBookingFormProblem({ ...filled, date: "2026-11-01" }).field, "date");
  });

  test("fields are checked in the order the form shows them (date, time, address)", () => {
    assert.strictEqual(findBookingFormProblem({ date: "", time: "", address: "", minimumDate: TODAY }).field, "date");
    assert.strictEqual(findBookingFormProblem({ ...filled, time: "", address: "" }).field, "time");
  });

  test("a complete form has no problem", () => {
    assert.strictEqual(findBookingFormProblem(filled), null);
    // While the earliest date is still loading, any chosen date is accepted.
    assert.strictEqual(findBookingFormProblem({ ...filled, minimumDate: "" }), null);
  });
});

describe("Bug Card 1: the server still refuses an empty address", () => {
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

  test("Expected: no booking is created when the address is empty", async () => {
    let date = addDaysToDateString(localDateString(), 1);
    while ([0, 6].includes(getDayOfWeekFromDateString(date))) date = addDaysToDateString(date, 1);
    const user = getUserByEmail("customer@saiping.com");
    const res = await bookingsPOST(
      new Request("http://localhost/api/bookings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `session_token=${createUserSession(user.id).token}`,
        },
        body: JSON.stringify({
          name: "Alice Customer",
          email: "customer@saiping.com",
          serviceId: "essential",
          date,
          time: "14:00",
          address: "",
        }),
      }),
    );
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /service address/);
    assert.strictEqual(getDatabase().prepare("SELECT COUNT(*) AS n FROM bookings").get().n, 0);
  });
});
