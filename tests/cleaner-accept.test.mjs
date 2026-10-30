import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  createBooking,
  createUserSession,
  getDatabase,
  getUserByEmail,
  resetDatabaseForTesting,
  getAvailableBookingRequests,
  getCleanerBookings,
  getAllBookingsAdmin,
} from "../src/lib/booking-store.ts";
import { POST as handleAcceptPOST } from "../src/app/api/cleaner/bookings/[id]/accept/route.ts";
import { GET as handleCleanerBookingsGET } from "../src/app/api/cleaner/bookings/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

describe("Cleaner Request Acceptance and Separate Pages", () => {
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

  test("Cleaner can see available customer requests and accept a request", async () => {
    // 1. Create a customer booking request
    const createResult = createBooking({
      name: "Bob Client",
      email: "bob@example.com",
      serviceId: "essential",
      date: "2026-11-15",
      time: "09:00",
      address: "456 Oak Avenue",
    });
    assert.strictEqual(createResult.status, "created");
    const bookingId = createResult.booking.id;

    // 2. Check available requests - should show 1 available request
    const available = getAvailableBookingRequests();
    assert.strictEqual(available.length, 1);
    assert.strictEqual(available[0].id, bookingId);
    assert.strictEqual(available[0].name, "Bob Client");
    assert.strictEqual(available[0].isAccepted, false);

    // 3. Authenticate cleaner
    const cleaner = getUserByEmail("cleaner@saiping.com");
    assert.ok(cleaner);
    const cleanerSession = createUserSession(cleaner.id);

    // 4. Cleaner accepts the request via API
    const req = new Request(`http://localhost/api/cleaner/bookings/${bookingId}/accept`, {
      method: "POST",
      headers: { cookie: `session_token=${cleanerSession.token}` },
    });
    const res = await handleAcceptPOST(req, {
      params: Promise.resolve({ id: bookingId }),
    });
    assert.strictEqual(res.status, 200);
    const acceptData = await res.json();
    assert.strictEqual(acceptData.success, true);

    // 5. Verify it is no longer in available requests
    const remainingAvailable = getAvailableBookingRequests();
    assert.strictEqual(remainingAvailable.length, 0);

    // 6. Verify cleaner now has this job scheduled
    const cleanerBookings = getCleanerBookings(cleaner.cleanerId || "cleaner-001");
    const acceptedJob = cleanerBookings.find((b) => b.id === bookingId);
    assert.ok(acceptedJob);
    assert.strictEqual(acceptedJob.acceptedByName, cleaner.name);
    assert.strictEqual(acceptedJob.isAccepted, true);

    // 7. Verify Admin sees the cleaner who accepted the clean request
    const adminBookings = getAllBookingsAdmin();
    const adminJob = adminBookings.find((b) => b.id === bookingId);
    assert.ok(adminJob);
    assert.strictEqual(adminJob.acceptedByName, cleaner.name);
    assert.strictEqual(adminJob.isAccepted, true);
  });

  test("Unauthorized user (e.g. customer) cannot accept cleaning requests", async () => {
    const customer = getUserByEmail("customer@saiping.com");
    assert.ok(customer);
    const custSession = createUserSession(customer.id);

    const req = new Request("http://localhost/api/cleaner/bookings/booking-123/accept", {
      method: "POST",
      headers: { cookie: `session_token=${custSession.token}` },
    });
    const res = await handleAcceptPOST(req, {
      params: Promise.resolve({ id: "booking-123" }),
    });
    assert.strictEqual(res.status, 403);
  });

  test("Unauthenticated request to accept returns 401", async () => {
    const req = new Request("http://localhost/api/cleaner/bookings/booking-123/accept", {
      method: "POST",
    });
    const res = await handleAcceptPOST(req, {
      params: Promise.resolve({ id: "booking-123" }),
    });
    assert.strictEqual(res.status, 401);
  });

  test("Cleaner bookings endpoint returns both assigned bookings and available requests", async () => {
    const cleaner = getUserByEmail("cleaner@saiping.com");
    assert.ok(cleaner);
    const cleanerSession = createUserSession(cleaner.id);

    createBooking({
      name: "Charlie Customer",
      email: "charlie@example.com",
      serviceId: "deep",
      date: "2026-11-20",
      time: "14:00",
      address: "789 Pine Road",
    });

    const req = new Request("http://localhost/api/cleaner/bookings", {
      headers: { cookie: `session_token=${cleanerSession.token}` },
    });
    const res = await handleCleanerBookingsGET(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.ok(Array.isArray(data.availableRequests));
    assert.strictEqual(data.availableRequests.length, 1);
    assert.strictEqual(data.availableRequests[0].name, "Charlie Customer");
  });
});
