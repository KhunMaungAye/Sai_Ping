import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { addDaysToDateString, localDateString } from "../src/lib/date-utils.ts";
import {
  createBooking,
  createUser,
  createUserSession,
  getBookingRatingDetails,
  getDatabase,
  getUserByEmail,
  markBookingCompleted,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import { GET as bookingsGET } from "../src/app/api/bookings/route.ts";
import { GET as customerBookingsGET } from "../src/app/api/customer/bookings/route.ts";
import { POST as ratingPOST } from "../src/app/api/bookings/[id]/rating/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

const CUSTOMER = "customer@saiping.com";

/** Every way a client might try to pass a bare email off as its identity. */
const EMAIL_ONLY_HEADERS = [
  { "x-customer-email": CUSTOMER },
  { authorization: `Bearer ${CUSTOMER}` },
  { "x-session-token": CUSTOMER },
  { cookie: `session_token=${CUSTOMER}` },
  { cookie: `customer_session=${CUSTOMER}` },
  { cookie: `customer_email=${CUSTOMER}` },
];

describe("Auth: a bare email is never accepted as identity", () => {
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

  function completedBooking() {
    const result = createBooking({
      name: "Alice Customer",
      email: CUSTOMER,
      serviceId: "essential",
      date: addDaysToDateString(localDateString(new Date()), -2),
      time: "09:00",
      address: "1 Test Road",
    });
    assert.equal(result.status, "created");
    markBookingCompleted(result.booking.id, "cleaner-001");
    return result.booking;
  }

  function rate(id, headers) {
    return ratingPOST(
      new Request(`http://localhost/api/bookings/${id}/rating`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ stars: 5 }),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  test("GET /api/bookings returns 401 for an email-only request", async () => {
    completedBooking();
    for (const headers of EMAIL_ONLY_HEADERS) {
      const res = await bookingsGET(new Request("http://localhost/api/bookings", { headers }));
      assert.equal(res.status, 401, `expected 401 for ${JSON.stringify(headers)}`);
    }
  });

  test("GET /api/customer/bookings returns 401 for an email-only request", async () => {
    for (const headers of EMAIL_ONLY_HEADERS) {
      const res = await customerBookingsGET(
        new Request("http://localhost/api/customer/bookings", { headers }),
      );
      assert.equal(res.status, 401, `expected 401 for ${JSON.stringify(headers)}`);
    }
  });

  test("POST rating returns 401 for an email-only request and saves nothing", async () => {
    const booking = completedBooking();
    for (const headers of EMAIL_ONLY_HEADERS) {
      const res = await rate(booking.id, headers);
      assert.equal(res.status, 401, `expected 401 for ${JSON.stringify(headers)}`);
    }
    assert.equal(getBookingRatingDetails(booking.id).rating ?? null, null);
  });

  test("a session never carries over to a new account registered with the same email", async () => {
    const original = createUser({ email: "dana@example.com", passwordHash: "x", name: "Dana", role: "customer" });
    const oldToken = createUserSession(original.id).token;
    const list = (token) =>
      bookingsGET(new Request("http://localhost/api/bookings", { headers: { cookie: `session_token=${token}` } }));
    assert.equal((await list(oldToken)).status, 200);

    // The account is removed and someone else registers the same email. (The
    // sessions foreign key normally blocks this delete; switch it off to prove
    // the token still can't jump to the new account if a row ever goes away.)
    getDatabase().exec("PRAGMA foreign_keys = OFF;");
    getDatabase().prepare("DELETE FROM users WHERE id = ?").run(original.id);
    getDatabase().exec("PRAGMA foreign_keys = ON;");
    const newcomer = createUser({ email: "dana@example.com", passwordHash: "y", name: "New Dana", role: "customer" });

    assert.equal((await list(oldToken)).status, 401);
    assert.equal((await list(createUserSession(newcomer.id).token)).status, 200);
  });

  test("a token found only in the legacy customer_sessions table is not accepted", async () => {
    getDatabase()
      .prepare("INSERT INTO customer_sessions (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run("legacy-token", CUSTOMER, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());
    const res = await bookingsGET(
      new Request("http://localhost/api/bookings", { headers: { cookie: "customer_session=legacy-token" } }),
    );
    assert.equal(res.status, 401);
  });

  test("the same requests succeed with a real session token", async () => {
    const booking = completedBooking();
    const token = createUserSession(getUserByEmail(CUSTOMER).id).token;

    const list = await bookingsGET(
      new Request("http://localhost/api/bookings", { headers: { cookie: `session_token=${token}` } }),
    );
    assert.equal(list.status, 200);
    assert.equal((await list.json()).bookings.length, 1);

    const rated = await rate(booking.id, { authorization: `Bearer ${token}` });
    assert.equal(rated.status, 201);
    assert.equal(getBookingRatingDetails(booking.id).rating, 5);
  });
});
