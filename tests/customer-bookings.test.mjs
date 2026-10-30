import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  localDateString,
} from "../src/lib/date-utils.ts";
import {
  createBooking,
  markBookingCompleted,
  submitBookingRating,
  getCustomerBookings,
  createCustomerSession,
  resetDatabaseForTesting,
  getDatabase,
} from "../src/lib/booking-store.ts";
import { GET as handleBookingsGET } from "../src/app/api/bookings/route.ts";
import { GET as handleCustomerBookingsGET } from "../src/app/api/customer/bookings/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

describe("US-02: View Cleaning Bookings", () => {
  let testDb;

  beforeEach(() => {
    testDb = new DatabaseSync(":memory:");
    resetDatabaseForTesting(testDb);
    seedTestUsers();
    getDatabase(); // initialize schema on testDb
  });

  afterEach(() => {
    resetDatabaseForTesting();
    try {
      testDb.close();
    } catch {}
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Customer can view upcoming and previous bookings categorized correctly
  // --------------------------------------------------------------------------
  test("Scenario 1: Authenticated customer retrieves bookings categorized into upcoming and previous", async () => {
    const today = new Date();
    const futureDate1 = addDaysToDateString(localDateString(today), 2);
    const futureDate2 = addDaysToDateString(localDateString(today), 9);
    const pastDate = addDaysToDateString(localDateString(today), -5);

    // Upcoming booking 1
    createBooking({
      name: "Alice Johnson",
      email: "alice@example.com",
      serviceId: "essential",
      date: futureDate1,
      time: "09:00",
      address: "123 Maple Street",
    });

    // Upcoming booking 2
    createBooking({
      name: "Alice Johnson",
      email: "alice@example.com",
      serviceId: "deep",
      date: futureDate2,
      time: "14:00",
      address: "123 Maple Street",
    });

    // Completed past booking
    const pastResult = createBooking({
      name: "Alice Johnson",
      email: "alice@example.com",
      serviceId: "move-out",
      date: pastDate,
      time: "09:00",
      address: "123 Maple Street",
    });
    assert.strictEqual(pastResult.status, "created");
    markBookingCompleted(pastResult.booking.id, "cleaner-001");
    submitBookingRating(pastResult.booking.id, 5);

    // Call API route with session cookie
    const req = new Request("http://localhost/api/bookings", {
      headers: {
        cookie: "customer_session=alice@example.com",
      },
    });
    const res = await handleBookingsGET(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.customer.email, "alice@example.com");
    assert.strictEqual(data.bookings.length, 3);
    assert.strictEqual(data.upcoming.length, 2);
    assert.strictEqual(data.previous.length, 1);

    // Verify store helper function directly
    const storeBookings = getCustomerBookings("alice@example.com");
    assert.strictEqual(storeBookings.bookings.length, 3);
    assert.strictEqual(storeBookings.upcoming.length, 2);
    assert.strictEqual(storeBookings.previous.length, 1);

    // Verify upcoming categorization and sorting (earliest first)
    assert.strictEqual(data.upcoming[0].date, futureDate1);
    assert.strictEqual(data.upcoming[0].isUpcoming, true);
    assert.strictEqual(data.upcoming[1].date, futureDate2);
    assert.strictEqual(data.upcoming[1].isUpcoming, true);

    // Verify previous categorization
    assert.strictEqual(data.previous[0].date, pastDate);
    assert.strictEqual(data.previous[0].isUpcoming, false);
    assert.strictEqual(data.previous[0].status, "completed");
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Displays relevant details, cleaner information, readable status labels, and ratings
  // --------------------------------------------------------------------------
  test("Scenario 2: Returns complete booking details with cleaner name, readable status label, and ratings", async () => {
    const today = new Date();
    const futureDate = addDaysToDateString(localDateString(today), 3);
    const pastDate = addDaysToDateString(localDateString(today), -2);

    // Upcoming booking
    const upcoming = createBooking({
      name: "David Smith",
      email: "david@example.com",
      serviceId: "essential",
      date: futureDate,
      time: "09:00",
      address: "742 Evergreen Terrace",
    });

    // Completed booking
    const completed = createBooking({
      name: "David Smith",
      email: "david@example.com",
      serviceId: "deep",
      date: pastDate,
      time: "14:00",
      address: "742 Evergreen Terrace",
    });
    markBookingCompleted(completed.booking.id, "cleaner-001");
    submitBookingRating(completed.booking.id, 4);

    const req = new Request("http://localhost/api/bookings", {
      headers: {
        "x-customer-email": "david@example.com",
      },
    });
    const res = await handleBookingsGET(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    const upcomingItem = data.upcoming[0];
    assert.strictEqual(upcomingItem.id, upcoming.booking.id);
    assert.strictEqual(upcomingItem.serviceName, "Essential clean");
    assert.strictEqual(upcomingItem.priceCents, 8900);
    assert.strictEqual(upcomingItem.date, futureDate);
    assert.strictEqual(upcomingItem.time, "09:00");
    assert.strictEqual(upcomingItem.cleanerName, "Sai Ping Cleaning Team");
    assert.strictEqual(upcomingItem.status, "scheduled");
    assert.strictEqual(upcomingItem.statusLabel, "Scheduled");
    assert.strictEqual(upcomingItem.address, "742 Evergreen Terrace");

    const previousItem = data.previous[0];
    assert.strictEqual(previousItem.id, completed.booking.id);
    assert.strictEqual(previousItem.serviceName, "Deep clean");
    assert.strictEqual(previousItem.status, "completed");
    assert.strictEqual(previousItem.statusLabel, "Completed");
    assert.strictEqual(previousItem.cleanerName, "Sai Ping Cleaning Team");
    assert.strictEqual(previousItem.rating, 4);
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Customer Data Isolation - never exposes another customer's bookings
  // --------------------------------------------------------------------------
  test("Scenario 3: Enforces strict server-side customer data isolation between different customers", async () => {
    const today = new Date();
    const date1 = addDaysToDateString(localDateString(today), 4);
    const date2 = addDaysToDateString(localDateString(today), 5);

    // Customer Alice bookings
    createBooking({
      name: "Alice Johnson",
      email: "alice@example.com",
      serviceId: "essential",
      date: date1,
      time: "09:00",
      address: "100 Alice Road",
    });

    // Customer Bob bookings
    createBooking({
      name: "Bob Williams",
      email: "bob@example.com",
      serviceId: "deep",
      date: date2,
      time: "14:00",
      address: "200 Bob Blvd",
    });

    // Request as Alice
    const aliceReq = new Request("http://localhost/api/bookings", {
      headers: { "x-customer-email": "alice@example.com" },
    });
    const aliceRes = await handleBookingsGET(aliceReq);
    assert.strictEqual(aliceRes.status, 200);
    const aliceData = await aliceRes.json();

    assert.strictEqual(aliceData.bookings.length, 1);
    assert.strictEqual(aliceData.bookings[0].email, "alice@example.com");
    assert.strictEqual(aliceData.bookings[0].address, "100 Alice Road");

    // Request as Bob
    const bobReq = new Request("http://localhost/api/bookings", {
      headers: { "x-customer-email": "bob@example.com" },
    });
    const bobRes = await handleBookingsGET(bobReq);
    assert.strictEqual(bobRes.status, 200);
    const bobData = await bobRes.json();

    assert.strictEqual(bobData.bookings.length, 1);
    assert.strictEqual(bobData.bookings[0].email, "bob@example.com");
    assert.strictEqual(bobData.bookings[0].address, "200 Bob Blvd");
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Authorization ignores client-supplied customer ID/email query params
  // --------------------------------------------------------------------------
  test("Scenario 4: Never trusts client-supplied query parameter customer ID to bypass authorization", async () => {
    const today = new Date();
    const date1 = addDaysToDateString(localDateString(today), 4);
    const date2 = addDaysToDateString(localDateString(today), 5);

    createBooking({
      name: "Alice Johnson",
      email: "alice@example.com",
      serviceId: "essential",
      date: date1,
      time: "09:00",
      address: "100 Alice Road",
    });

    createBooking({
      name: "Bob Williams",
      email: "bob@example.com",
      serviceId: "deep",
      date: date2,
      time: "14:00",
      address: "200 Bob Blvd",
    });

    // Alice is authenticated via session, but attempts to query Bob's email via query string
    const maliciousReq = new Request(
      "http://localhost/api/bookings?email=bob@example.com&customerId=bob@example.com",
      {
        headers: { "x-customer-email": "alice@example.com" },
      },
    );
    const res = await handleBookingsGET(maliciousReq);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    // Must return Alice's bookings only, strictly ignoring the query param!
    assert.strictEqual(data.customer.email, "alice@example.com");
    assert.strictEqual(data.bookings.length, 1);
    assert.strictEqual(data.bookings[0].email, "alice@example.com");
    assert.strictEqual(data.bookings[0].address, "100 Alice Road");
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Unauthorized requests return 401 Unauthorized
  // --------------------------------------------------------------------------
  test("Scenario 5: Rejects unauthenticated requests with 401 Unauthorized", async () => {
    // No auth header or cookie
    const unauthReq1 = new Request("http://localhost/api/bookings");
    const res1 = await handleBookingsGET(unauthReq1);
    assert.strictEqual(res1.status, 401);
    const data1 = await res1.json();
    assert.ok(data1.error.includes("Unauthorized"));

    // Attempt to access with query param but without auth credentials
    const unauthReq2 = new Request(
      "http://localhost/api/bookings?email=alice@example.com",
    );
    const res2 = await handleBookingsGET(unauthReq2);
    assert.strictEqual(res2.status, 401);
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Supports session token in database, Bearer auth, and cookies
  // --------------------------------------------------------------------------
  test("Scenario 6: Authenticates via SQLite session token, Bearer auth, or cookie", async () => {
    const today = new Date();
    const date = addDaysToDateString(localDateString(today), 3);

    createBooking({
      name: "Charlie Brown",
      email: "charlie@example.com",
      serviceId: "essential",
      date,
      time: "09:00",
      address: "300 Peanut Way",
    });

    // 1. Session token created in SQLite customer_sessions
    const sessionToken = createCustomerSession("charlie@example.com");

    const tokenReq = new Request("http://localhost/api/bookings", {
      headers: {
        cookie: `customer_session=${sessionToken}`,
      },
    });
    const tokenRes = await handleBookingsGET(tokenReq);
    assert.strictEqual(tokenRes.status, 200);
    const tokenData = await tokenRes.json();
    assert.strictEqual(tokenData.bookings.length, 1);

    // 2. Bearer token in Authorization header
    const bearerReq = new Request("http://localhost/api/bookings", {
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
    const bearerRes = await handleBookingsGET(bearerReq);
    assert.strictEqual(bearerRes.status, 200);
    const bearerData = await bearerRes.json();
    assert.strictEqual(bearerData.bookings.length, 1);

    // 3. Direct Bearer email
    const directBearerReq = new Request("http://localhost/api/bookings", {
      headers: {
        authorization: "Bearer charlie@example.com",
      },
    });
    const directBearerRes = await handleBookingsGET(directBearerReq);
    assert.strictEqual(directBearerRes.status, 200);
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Handles empty booking list appropriately
  // --------------------------------------------------------------------------
  test("Scenario 7: Returns empty lists gracefully for customer with no existing bookings", async () => {
    const req = new Request("http://localhost/api/bookings", {
      headers: { "x-customer-email": "newcustomer@example.com" },
    });
    const res = await handleBookingsGET(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.customer.email, "newcustomer@example.com");
    assert.deepStrictEqual(data.bookings, []);
    assert.deepStrictEqual(data.upcoming, []);
    assert.deepStrictEqual(data.previous, []);
  });

  // --------------------------------------------------------------------------
  // Scenario 8: /api/customer/bookings endpoint functions identically
  // --------------------------------------------------------------------------
  test("Scenario 8: /api/customer/bookings route enforces authentication and returns categorized bookings", async () => {
    const today = new Date();
    const futureDate = addDaysToDateString(localDateString(today), 4);

    createBooking({
      name: "Grace Hopper",
      email: "grace@example.com",
      serviceId: "essential",
      date: futureDate,
      time: "09:00",
      address: "500 Compiler Lane",
    });

    // Unauthorized call to /api/customer/bookings
    const unauthRes = await handleCustomerBookingsGET(
      new Request("http://localhost/api/customer/bookings"),
    );
    assert.strictEqual(unauthRes.status, 401);

    // Authorized call
    const authRes = await handleCustomerBookingsGET(
      new Request("http://localhost/api/customer/bookings", {
        headers: { "x-customer-email": "grace@example.com" },
      }),
    );
    assert.strictEqual(authRes.status, 200);
    const data = await authRes.json();
    assert.strictEqual(data.customer.email, "grace@example.com");
    assert.strictEqual(data.upcoming.length, 1);
  });
});
