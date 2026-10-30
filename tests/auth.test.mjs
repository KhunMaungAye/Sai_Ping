import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  createUserSession,
  getDatabase,
  getUserByEmail,
  resetDatabaseForTesting,
  updateUserStatus,
} from "../src/lib/booking-store.ts";
import {
  validateRedirect,
} from "../src/lib/auth.ts";
import { POST as handleLoginPOST } from "../src/app/api/auth/login/route.ts";
import { POST as handleLogoutPOST } from "../src/app/api/auth/logout/route.ts";
import { GET as handleSessionGET } from "../src/app/api/auth/session/route.ts";
import { GET as handleCustomerBookingsGET } from "../src/app/api/bookings/route.ts";
import { GET as handleCleanerBookingsGET } from "../src/app/api/cleaner/bookings/route.ts";
import { POST as handleCleanerCompletePOST } from "../src/app/api/cleaner/bookings/[id]/complete/route.ts";
import { GET as handleAdminBookingsGET } from "../src/app/api/admin/bookings/route.ts";
import { GET as handleAdminUsersGET } from "../src/app/api/admin/users/route.ts";
import { POST as handleAdminUserStatusPOST } from "../src/app/api/admin/users/[id]/status/route.ts";
import { seedTestUsers } from "./helpers/seed-test-users.mjs";

describe("US-12: Role-Based Authentication System", () => {
  let testDb;

  beforeEach(() => {
    testDb = new DatabaseSync(":memory:");
    resetDatabaseForTesting(testDb);
    seedTestUsers();
    getDatabase(); // initialize schema on testDb (includes seed users)
  });

  afterEach(() => {
    resetDatabaseForTesting();
    try {
      testDb.close();
    } catch {}
  });

  // ==========================================================================
  // A. Login & Credential Verification Tests
  // ==========================================================================

  test("A1: Valid customer can log in with email and password", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "customer@saiping.com",
        password: "CustomerPassword123!",
      }),
    });

    const res = await handleLoginPOST(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.email, "customer@saiping.com");
    assert.strictEqual(data.user.role, "customer");
    assert.strictEqual(data.redirectUrl, "/bookings");
    assert.strictEqual(data.user.password, undefined);
    assert.strictEqual(data.user.password_hash, undefined);

    const setCookie = res.headers.get("set-cookie");
    assert.ok(setCookie);
    assert.ok(setCookie.includes("session_token="));
    assert.ok(setCookie.includes("HttpOnly"));
  });

  test("A2: Valid cleaner can log in and receives cleaner dashboard redirect", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "cleaner@saiping.com",
        password: "CleanerPassword123!",
      }),
    });

    const res = await handleLoginPOST(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.email, "cleaner@saiping.com");
    assert.strictEqual(data.user.role, "cleaner");
    assert.strictEqual(data.redirectUrl, "/dashboard/cleaner");
    assert.strictEqual(data.user.password, undefined);
    assert.strictEqual(data.user.password_hash, undefined);
  });

  test("A3: Valid admin can log in and receives admin dashboard redirect", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@saiping.com",
        password: "AdminPassword123!",
      }),
    });

    const res = await handleLoginPOST(req);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.email, "admin@saiping.com");
    assert.strictEqual(data.user.role, "admin");
    assert.strictEqual(data.redirectUrl, "/dashboard/admin");
    assert.strictEqual(data.user.password, undefined);
    assert.strictEqual(data.user.password_hash, undefined);
  });

  test("A4: Incorrect password is rejected with generic 401 error", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "customer@saiping.com",
        password: "WrongPassword999!",
      }),
    });

    const res = await handleLoginPOST(req);
    assert.strictEqual(res.status, 401);

    const data = await res.json();
    assert.strictEqual(data.error, "Invalid email or password.");
    assert.strictEqual(res.headers.get("set-cookie"), null);
  });

  test("A5: Nonexistent account is rejected with identical generic 401 error", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonexistent@saiping.com",
        password: "AnyPassword123!",
      }),
    });

    const res = await handleLoginPOST(req);
    assert.strictEqual(res.status, 401);

    const data = await res.json();
    assert.strictEqual(data.error, "Invalid email or password.");
    assert.strictEqual(res.headers.get("set-cookie"), null);
  });

  test("A6: Empty email or password returns 400 Bad Request", async () => {
    // Missing email
    const req1 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "", password: "SomePassword123!" }),
    });
    const res1 = await handleLoginPOST(req1);
    assert.strictEqual(res1.status, 400);

    // Missing password
    const req2 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "customer@saiping.com", password: "" }),
    });
    const res2 = await handleLoginPOST(req2);
    assert.strictEqual(res2.status, 400);

    // Malformed email
    const req3 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "SomePassword123!" }),
    });
    const res3 = await handleLoginPOST(req3);
    assert.strictEqual(res3.status, 400);
  });

  test("A7: Suspended accounts are rejected with 403 Forbidden", async () => {
    const customer = getUserByEmail("customer@saiping.com");
    assert.ok(customer);
    updateUserStatus(customer.id, "suspended");

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "customer@saiping.com",
        password: "CustomerPassword123!",
      }),
    });

    const res = await handleLoginPOST(req);
    assert.strictEqual(res.status, 403);

    const data = await res.json();
    assert.ok(data.error.includes("suspended"));
    assert.strictEqual(res.headers.get("set-cookie"), null);
  });

  // ==========================================================================
  // B. Role Authorization Tests
  // ==========================================================================

  test("B1: Customer can access customer bookings, but is denied from cleaner and admin endpoints", async () => {
    const customer = getUserByEmail("customer@saiping.com");
    assert.ok(customer);
    const session = createUserSession(customer.id);
    const authHeaders = { cookie: `session_token=${session.token}` };

    // 1. Customer accessing Customer Bookings -> 200 OK
    const custReq = new Request("http://localhost/api/bookings", { headers: authHeaders });
    const custRes = await handleCustomerBookingsGET(custReq);
    assert.strictEqual(custRes.status, 200);

    // 2. Customer accessing Cleaner Endpoints -> 403 Forbidden
    const cleanerReq = new Request("http://localhost/api/cleaner/bookings", { headers: authHeaders });
    const cleanerRes = await handleCleanerBookingsGET(cleanerReq);
    assert.strictEqual(cleanerRes.status, 403);

    // 3. Customer accessing Admin Bookings -> 403 Forbidden
    const adminReq = new Request("http://localhost/api/admin/bookings", { headers: authHeaders });
    const adminRes = await handleAdminBookingsGET(adminReq);
    assert.strictEqual(adminRes.status, 403);

    // 4. Customer accessing Admin Users -> 403 Forbidden
    const adminUsersReq = new Request("http://localhost/api/admin/users", { headers: authHeaders });
    const adminUsersRes = await handleAdminUsersGET(adminUsersReq);
    assert.strictEqual(adminUsersRes.status, 403);
  });

  test("B2: Cleaner can access cleaner resources, but is denied from admin and customer-only endpoints", async () => {
    const cleaner = getUserByEmail("cleaner@saiping.com");
    assert.ok(cleaner);
    const session = createUserSession(cleaner.id);
    const authHeaders = { cookie: `session_token=${session.token}` };

    // 1. Cleaner accessing Cleaner Bookings -> 200 OK
    const cleanerReq = new Request("http://localhost/api/cleaner/bookings", { headers: authHeaders });
    const cleanerRes = await handleCleanerBookingsGET(cleanerReq);
    assert.strictEqual(cleanerRes.status, 200);
    const cleanerData = await cleanerRes.json();
    assert.strictEqual(cleanerData.cleanerId, "cleaner-001");

    // 2. Cleaner accessing Admin Bookings -> 403 Forbidden
    const adminReq = new Request("http://localhost/api/admin/bookings", { headers: authHeaders });
    const adminRes = await handleAdminBookingsGET(adminReq);
    assert.strictEqual(adminRes.status, 403);

    // 3. Cleaner accessing Customer Bookings endpoint -> 403 Forbidden
    const custReq = new Request("http://localhost/api/bookings", { headers: authHeaders });
    const custRes = await handleCustomerBookingsGET(custReq);
    assert.strictEqual(custRes.status, 403);
  });

  test("B3: Admin can access admin endpoints and views all bookings and user accounts", async () => {
    const admin = getUserByEmail("admin@saiping.com");
    assert.ok(admin);
    const session = createUserSession(admin.id);
    const authHeaders = { cookie: `session_token=${session.token}` };

    // 1. Admin Bookings endpoint -> 200 OK
    const adminReq = new Request("http://localhost/api/admin/bookings", { headers: authHeaders });
    const adminRes = await handleAdminBookingsGET(adminReq);
    assert.strictEqual(adminRes.status, 200);
    const adminData = await adminRes.json();
    assert.ok(adminData.stats);
    assert.ok(Array.isArray(adminData.bookings));

    // 2. Admin Users endpoint -> 200 OK
    const usersReq = new Request("http://localhost/api/admin/users", { headers: authHeaders });
    const usersRes = await handleAdminUsersGET(usersReq);
    assert.strictEqual(usersRes.status, 200);
    const usersData = await usersRes.json();
    assert.ok(usersData.users.length >= 3);
  });

  test("B4: Unauthenticated requests to protected endpoints return 401 Unauthorized", async () => {
    // Customer endpoint unauthenticated
    const res1 = await handleCustomerBookingsGET(new Request("http://localhost/api/bookings"));
    assert.strictEqual(res1.status, 401);

    // Cleaner endpoint unauthenticated
    const res2 = await handleCleanerBookingsGET(new Request("http://localhost/api/cleaner/bookings"));
    assert.strictEqual(res2.status, 401);

    // Admin endpoint unauthenticated
    const res3 = await handleAdminBookingsGET(new Request("http://localhost/api/admin/bookings"));
    assert.strictEqual(res3.status, 401);
  });

  test("B5: Client tampering with query parameters or headers cannot escalate privileges", async () => {
    const customer = getUserByEmail("customer@saiping.com");
    assert.ok(customer);
    const session = createUserSession(customer.id);

    // Malicious customer sends role=admin in query string and fake headers
    const tamperedReq = new Request(
      "http://localhost/api/admin/bookings?role=admin&userRole=admin",
      {
        headers: {
          cookie: `session_token=${session.token}`,
          "x-user-role": "admin",
          "x-role": "admin",
        },
      },
    );

    const res = await handleAdminBookingsGET(tamperedReq);
    assert.strictEqual(res.status, 403);
  });

  // ==========================================================================
  // C. Session Management & Persistence Tests
  // ==========================================================================

  test("C1: Successful login creates a persistent session verified by /api/auth/session", async () => {
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "customer@saiping.com",
        password: "CustomerPassword123!",
      }),
    });
    const loginRes = await handleLoginPOST(loginReq);
    assert.strictEqual(loginRes.status, 200);

    const setCookie = loginRes.headers.get("set-cookie") || "";
    const match = setCookie.match(/session_token=([^;]+)/);
    assert.ok(match);
    const token = decodeURIComponent(match[1]);

    // Check session route with cookie
    const sessionReq = new Request("http://localhost/api/auth/session", {
      headers: { cookie: `session_token=${token}` },
    });
    const sessionRes = await handleSessionGET(sessionReq);
    assert.strictEqual(sessionRes.status, 200);

    const sessionData = await sessionRes.json();
    assert.strictEqual(sessionData.authenticated, true);
    assert.strictEqual(sessionData.user.email, "customer@saiping.com");
    assert.strictEqual(sessionData.user.role, "customer");
  });

  test("C2: Logout invalidates the server session and clears the cookie", async () => {
    const customer = getUserByEmail("customer@saiping.com");
    assert.ok(customer);
    const session = createUserSession(customer.id);

    // Send logout request
    const logoutReq = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { cookie: `session_token=${session.token}` },
    });
    const logoutRes = await handleLogoutPOST(logoutReq);
    assert.strictEqual(logoutRes.status, 200);

    const setCookie = logoutRes.headers.get("set-cookie") || "";
    assert.ok(setCookie.includes("Max-Age=0"));

    // Verify session token is no longer accepted
    const checkReq = new Request("http://localhost/api/auth/session", {
      headers: { cookie: `session_token=${session.token}` },
    });
    const checkRes = await handleSessionGET(checkReq);
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.authenticated, false);

    // Protected customer route also rejects invalidated session
    const custReq = new Request("http://localhost/api/bookings", {
      headers: { cookie: `session_token=${session.token}` },
    });
    const custRes = await handleCustomerBookingsGET(custReq);
    assert.strictEqual(custRes.status, 401);
  });

  test("C3: Expired or nonexistent session tokens are rejected safely", async () => {
    // Nonexistent random token
    const fakeReq = new Request("http://localhost/api/bookings", {
      headers: { cookie: "session_token=nonexistent-session-token-12345" },
    });
    const fakeRes = await handleCustomerBookingsGET(fakeReq);
    assert.strictEqual(fakeRes.status, 401);

    // Expired token (simulate past date)
    const customer = getUserByEmail("customer@saiping.com");
    assert.ok(customer);
    const expiredToken = "expired-token-123";
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    getDatabase()
      .prepare(
        "INSERT INTO sessions (token, user_id, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(expiredToken, customer.id, customer.email, customer.role, pastDate, pastDate);

    const expiredReq = new Request("http://localhost/api/bookings", {
      headers: { cookie: `session_token=${expiredToken}` },
    });
    const expiredRes = await handleCustomerBookingsGET(expiredReq);
    assert.strictEqual(expiredRes.status, 401);
  });

  // ==========================================================================
  // D. Redirect Safety & Administrative Operations
  // ==========================================================================

  test("D1: validateRedirect prevents open redirects and enforces role boundaries", () => {
    // Open redirect attempts to external sites are neutralized
    assert.strictEqual(validateRedirect("https://evil.com", "customer"), "/bookings");
    assert.strictEqual(validateRedirect("//evil.com", "cleaner"), "/dashboard/cleaner");
    assert.strictEqual(validateRedirect("/\\evil.com", "admin"), "/dashboard/admin");

    // Role boundary redirects
    assert.strictEqual(validateRedirect("/dashboard/admin", "customer"), "/bookings");
    assert.strictEqual(validateRedirect("/dashboard/admin", "cleaner"), "/dashboard/cleaner");
    assert.strictEqual(validateRedirect("/dashboard/cleaner", "customer"), "/bookings");
    assert.strictEqual(validateRedirect("/bookings", "cleaner"), "/dashboard/cleaner");

    // Allowed matching paths
    assert.strictEqual(validateRedirect("/dashboard/admin", "admin"), "/dashboard/admin");
    assert.strictEqual(validateRedirect("/dashboard/cleaner", "cleaner"), "/dashboard/cleaner");
    assert.strictEqual(validateRedirect("/bookings", "customer"), "/bookings");
  });

  test("D2: Admin can suspend a user account, immediately invalidating active sessions", async () => {
    const customer = getUserByEmail("customer@saiping.com");
    const admin = getUserByEmail("admin@saiping.com");
    assert.ok(customer && admin);

    const custSession = createUserSession(customer.id);
    const adminSession = createUserSession(admin.id);

    // Customer can access bookings before suspension
    const beforeReq = new Request("http://localhost/api/bookings", {
      headers: { cookie: `session_token=${custSession.token}` },
    });
    const beforeRes = await handleCustomerBookingsGET(beforeReq);
    assert.strictEqual(beforeRes.status, 200);

    // Admin suspends customer account
    const suspendReq = new Request(`http://localhost/api/admin/users/${customer.id}/status`, {
      method: "POST",
      headers: {
        cookie: `session_token=${adminSession.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "suspended" }),
    });
    const suspendRes = await handleAdminUserStatusPOST(suspendReq, {
      params: Promise.resolve({ id: customer.id }),
    });
    assert.strictEqual(suspendRes.status, 200);

    // Customer's existing session is immediately rejected
    const afterReq = new Request("http://localhost/api/bookings", {
      headers: { cookie: `session_token=${custSession.token}` },
    });
    const afterRes = await handleCustomerBookingsGET(afterReq);
    assert.strictEqual(afterRes.status, 401);

    // Customer cannot log in while suspended
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "customer@saiping.com",
        password: "CustomerPassword123!",
      }),
    });
    const loginRes = await handleLoginPOST(loginReq);
    assert.strictEqual(loginRes.status, 403);
  });

  test("D3: Admin cannot suspend themselves and invalid status values are rejected", async () => {
    const admin = getUserByEmail("admin@saiping.com");
    assert.ok(admin);
    const adminSession = createUserSession(admin.id);

    // Admin attempts self-suspension
    const selfReq = new Request(`http://localhost/api/admin/users/${admin.id}/status`, {
      method: "POST",
      headers: {
        cookie: `session_token=${adminSession.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "suspended" }),
    });
    const selfRes = await handleAdminUserStatusPOST(selfReq, {
      params: Promise.resolve({ id: admin.id }),
    });
    assert.strictEqual(selfRes.status, 400);

    // Invalid status string
    const customer = getUserByEmail("customer@saiping.com");
    assert.ok(customer);
    const invalidReq = new Request(`http://localhost/api/admin/users/${customer.id}/status`, {
      method: "POST",
      headers: {
        cookie: `session_token=${adminSession.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "deleted" }),
    });
    const invalidRes = await handleAdminUserStatusPOST(invalidReq, {
      params: Promise.resolve({ id: customer.id }),
    });
    assert.strictEqual(invalidRes.status, 400);
  });

  test("D4: Cleaner job completion validates booking existence and role permissions", async () => {
    const cleaner = getUserByEmail("cleaner@saiping.com");
    assert.ok(cleaner);
    const cleanerSession = createUserSession(cleaner.id);

    // Attempting to complete nonexistent booking -> 404
    const notFoundReq = new Request("http://localhost/api/cleaner/bookings/non-existent-id/complete", {
      method: "POST",
      headers: { cookie: `session_token=${cleanerSession.token}` },
    });
    const notFoundRes = await handleCleanerCompletePOST(notFoundReq, {
      params: Promise.resolve({ id: "non-existent-id" }),
    });
    assert.strictEqual(notFoundRes.status, 404);

    // Customer attempting to call cleaner complete -> 403
    const customer = getUserByEmail("customer@saiping.com");
    assert.ok(customer);
    const custSession = createUserSession(customer.id);
    const custReq = new Request("http://localhost/api/cleaner/bookings/any-id/complete", {
      method: "POST",
      headers: { cookie: `session_token=${custSession.token}` },
    });
    const custRes = await handleCleanerCompletePOST(custReq, {
      params: Promise.resolve({ id: "any-id" }),
    });
    assert.strictEqual(custRes.status, 403);
  });
});
