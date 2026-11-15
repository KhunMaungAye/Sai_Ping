import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createBooking,
  createUserSession,
  getCleanerApplications,
  getDatabase,
  getDayOfWeekFromDateString,
  getRecommendedCleaner,
  getUserByEmail,
  listAvailableDays,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import { POST as registerPOST } from "../src/app/api/auth/register/route.ts";
import { POST as acceptPOST } from "../src/app/api/cleaner/bookings/[id]/accept/route.ts";
import { GET as cleanerBookingsGET } from "../src/app/api/cleaner/bookings/route.ts";
import { POST as approvalPOST } from "../src/app/api/admin/cleaners/[id]/approval/route.ts";
import { GET as overviewGET } from "../src/app/api/admin/overview/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

function cookieFor(email) {
  return `session_token=${createUserSession(getUserByEmail(email).id).token}`;
}

/** Turns a register response's Set-Cookie headers into a request Cookie header. */
function cookieFrom(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function register(body) {
  return registerPOST(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function approve(cleanerId, body, email = "admin@saiping.com") {
  const headers = { "content-type": "application/json" };
  if (email) headers.cookie = cookieFor(email);
  return approvalPOST(
    new Request(`http://localhost/api/admin/cleaners/${cleanerId}/approval`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ id: cleanerId }) },
  );
}

function nextWeekday(weekday) {
  let date = addDaysToDateString(localDateString(), 1);
  while (getDayOfWeekFromDateString(date) !== weekday) date = addDaysToDateString(date, 1);
  return date;
}

describe("US-19: cleaner application and admin approval", () => {
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

  describe("Registration", () => {
    test("a cleaner application starts pending and saves the short form", async () => {
      const res = await register({
        name: "Som Cleaner",
        email: "som@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 234 5678",
        experienceYears: "3",
        areas: "Sukhumvit, Silom",
        about: "I love a tidy home.",
      });
      assert.equal(res.status, 201);

      const applications = getCleanerApplications();
      const app = applications.find((a) => a.email === "som@example.com");
      assert.ok(app);
      assert.equal(app.approvalStatus, "pending");
      assert.equal(app.phone, "081 234 5678");
      assert.equal(app.experienceYears, 3);
      assert.equal(app.areas, "Sukhumvit, Silom");
      assert.equal(app.about, "I love a tidy home.");
      assert.ok(app.appliedAt);
    });

    test("a phone number is required for a cleaner, not for a customer", async () => {
      const cleanerRes = await register({
        name: "No Phone",
        email: "nophone@example.com",
        password: "password123",
        role: "cleaner",
      });
      assert.equal(cleanerRes.status, 400);
      assert.match((await cleanerRes.json()).error, /phone number/);

      const customerRes = await register({
        name: "Customer Fine",
        email: "customerfine@example.com",
        password: "password123",
        role: "customer",
      });
      assert.equal(customerRes.status, 201);
    });

    test("an invalid phone or an out-of-range experience is rejected", async () => {
      const badPhone = await register({
        name: "Bad Phone",
        email: "badphone@example.com",
        password: "password123",
        role: "cleaner",
        phone: "not a phone",
      });
      assert.equal(badPhone.status, 400);

      const badExperience = await register({
        name: "Too Experienced",
        email: "exp@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 234 5678",
        experienceYears: "99",
      });
      assert.equal(badExperience.status, 400);
    });

    test("existing cleaners (seeded before US-19) stay approved", () => {
      const applications = getCleanerApplications();
      const existing = applications.find((a) => a.email === "cleaner@saiping.com");
      assert.ok(existing);
      assert.equal(existing.approvalStatus, "approved");
    });
  });

  describe("Pending cleaners are blocked", () => {
    test("their weekday doesn't open the platform up if no approved cleaner works it", async () => {
      // Neither seeded cleaner works Sunday, so it's closed until someone
      // approved does.
      getDatabase().exec(
        "UPDATE cleaners SET available_days = '1,2,3,4,5' WHERE id IN ('cleaner-001', 'cleaner-002')",
      );
      const sunday = nextWeekday(0);
      assert.deepStrictEqual(
        listAvailableDays(undefined, 14).find((d) => d.date === sunday).availableSlots,
        [],
      );

      const res = await register({
        name: "Sunday Only",
        email: "sunday@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 111 1111",
      });
      assert.equal(res.status, 201);
      const pendingCleanerId = getUserByEmail("sunday@example.com").cleanerId;
      getDatabase()
        .prepare("UPDATE cleaners SET available_days = '0' WHERE id = ?")
        .run(pendingCleanerId);

      // Still closed — the new cleaner is pending, not approved.
      assert.deepStrictEqual(
        listAvailableDays(undefined, 14).find((d) => d.date === sunday).availableSlots,
        [],
      );

      await approve(pendingCleanerId, { action: "approve" });
      assert.ok(
        listAvailableDays(undefined, 14).find((d) => d.date === sunday).availableSlots.length > 0,
      );
    });

    test("doesn't appear in the AI-01A recommendation", async () => {
      await register({
        name: "Pending Pim",
        email: "pim@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 222 2222",
      });
      const pendingCleanerId = getUserByEmail("pim@example.com").cleanerId;
      getDatabase()
        .prepare("UPDATE cleaners SET available_days = '0,1,2,3,4,5,6' WHERE id = ?")
        .run(pendingCleanerId);

      const tuesday = nextWeekday(2);
      const recommendation = getRecommendedCleaner(tuesday, "09:00");
      // The seeded approved cleaner may still be recommended; the pending
      // one must never be the one picked.
      if (recommendation) {
        assert.notEqual(recommendation.cleanerId, pendingCleanerId);
      }
    });

    test("can't accept a job", async () => {
      const res = await register({
        name: "Pending Nok",
        email: "pendingnok@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 333 3333",
      });
      const cleanerCookie = cookieFrom(res);
      const pendingCleanerId = getUserByEmail("pendingnok@example.com").cleanerId;
      getDatabase()
        .prepare("UPDATE cleaners SET available_days = '0,1,2,3,4,5,6' WHERE id = ?")
        .run(pendingCleanerId);

      const booking = createBooking({
        name: "A Customer",
        email: "acustomer@example.com",
        serviceId: "essential",
        date: nextWeekday(2),
        time: "09:00",
        address: "1 Sukhumvit Rd",
      });
      assert.equal(booking.status, "created");

      const accept = await acceptPOST(
        new Request(`http://localhost/api/cleaner/bookings/${booking.booking.id}/accept`, {
          method: "POST",
          headers: { cookie: cleanerCookie },
        }),
        { params: Promise.resolve({ id: booking.booking.id }) },
      );
      assert.equal(accept.status, 409);
      assert.match((await accept.json()).error, /under review/);
    });

    test("sees an 'under review' status and no available requests on their dashboard", async () => {
      const res = await register({
        name: "Dashboard Cleaner",
        email: "dashboard@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 444 4444",
      });
      const cleanerCookie = cookieFrom(res);

      const dashboard = await cleanerBookingsGET(
        new Request("http://localhost/api/cleaner/bookings", { headers: { cookie: cleanerCookie } }),
      );
      assert.equal(dashboard.status, 200);
      const data = await dashboard.json();
      assert.equal(data.approvalStatus, "pending");
      assert.deepStrictEqual(data.availableRequests, []);
    });
  });

  describe("POST /api/admin/cleaners/[id]/approval", () => {
    test("approving lets the cleaner accept jobs", async () => {
      await register({
        name: "Approve Me",
        email: "approveme@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 555 5555",
      });
      const cleanerId = getUserByEmail("approveme@example.com").cleanerId;
      getDatabase()
        .prepare("UPDATE cleaners SET available_days = '0,1,2,3,4,5,6' WHERE id = ?")
        .run(cleanerId);

      const approval = await approve(cleanerId, { action: "approve" });
      assert.equal(approval.status, 200);
      const body = await approval.json();
      assert.match(body.message, /approved/);
      assert.equal(body.application.approvalStatus, "approved");

      const booking = createBooking({
        name: "A Customer",
        email: "acustomer2@example.com",
        serviceId: "essential",
        date: nextWeekday(3),
        time: "14:00",
        address: "1 Sukhumvit Rd",
      });
      const accept = await acceptPOST(
        new Request(`http://localhost/api/cleaner/bookings/${booking.booking.id}/accept`, {
          method: "POST",
          headers: { cookie: cookieFor("approveme@example.com") },
        }),
        { params: Promise.resolve({ id: booking.booking.id }) },
      );
      assert.equal(accept.status, 200);
    });

    test("rejecting requires a reason and is shown to the cleaner", async () => {
      await register({
        name: "Reject Me",
        email: "rejectme@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 666 6666",
      });
      const cleanerId = getUserByEmail("rejectme@example.com").cleanerId;

      const noReason = await approve(cleanerId, { action: "reject" });
      assert.equal(noReason.status, 400);

      const rejected = await approve(cleanerId, {
        action: "reject",
        note: "Experience doesn't meet our minimum.",
      });
      assert.equal(rejected.status, 200);
      assert.equal((await rejected.json()).application.approvalStatus, "rejected");

      const dashboard = await cleanerBookingsGET(
        new Request("http://localhost/api/cleaner/bookings", {
          headers: { cookie: cookieFor("rejectme@example.com") },
        }),
      );
      const data = await dashboard.json();
      assert.equal(data.approvalStatus, "rejected");
      assert.equal(data.reviewNote, "Experience doesn't meet our minimum.");
    });

    test("re-approving clears an earlier rejection note", async () => {
      await register({
        name: "Second Chance",
        email: "secondchance@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 777 7777",
      });
      const cleanerId = getUserByEmail("secondchance@example.com").cleanerId;
      await approve(cleanerId, { action: "reject", note: "Not enough detail." });
      const reApproved = await approve(cleanerId, { action: "approve" });
      assert.equal((await reApproved.json()).application.reviewNote, null);
    });

    test("401 when signed out, 403 for a customer or cleaner", async () => {
      await register({
        name: "Auth Test",
        email: "authtest@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 888 8888",
      });
      const cleanerId = getUserByEmail("authtest@example.com").cleanerId;

      assert.equal((await approve(cleanerId, { action: "approve" }, null)).status, 401);
      assert.equal(
        (await approve(cleanerId, { action: "approve" }, "customer@saiping.com")).status,
        403,
      );
      assert.equal(
        (await approve(cleanerId, { action: "approve" }, "cleaner@saiping.com")).status,
        403,
      );
    });

    test("404 for an unknown cleaner id", async () => {
      const res = await approve("does-not-exist", { action: "approve" });
      assert.equal(res.status, 404);
    });

    test("400 for an invalid action", async () => {
      await register({
        name: "Bad Action",
        email: "badaction@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 999 9999",
      });
      const cleanerId = getUserByEmail("badaction@example.com").cleanerId;
      const res = await approve(cleanerId, { action: "maybe" });
      assert.equal(res.status, 400);
    });
  });

  describe("GET /api/admin/overview", () => {
    test("includes cleaner applications, admin only", async () => {
      await register({
        name: "Listed Cleaner",
        email: "listed@example.com",
        password: "password123",
        role: "cleaner",
        phone: "081 123 1234",
      });

      const res = await overviewGET(
        new Request("http://localhost/api/admin/overview", {
          headers: { cookie: cookieFor("admin@saiping.com") },
        }),
      );
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.cleanerApplications.some((a) => a.email === "listed@example.com"));

      const forbidden = await overviewGET(
        new Request("http://localhost/api/admin/overview", {
          headers: { cookie: cookieFor("customer@saiping.com") },
        }),
      );
      assert.equal(forbidden.status, 403);
    });
  });
});
