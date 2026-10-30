import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  addDaysToDateString,
  createBooking,
  getDatabase,
  getDayOfWeekFromDateString,
  getUserByEmail,
  listAvailableDays,
  localDateString,
  resetDatabaseForTesting,
} from "../src/lib/booking-store.ts";
import { POST as registerPOST } from "../src/app/api/auth/register/route.ts";
import { POST as loginPOST } from "../src/app/api/auth/login/route.ts";
import { GET as sessionGET } from "../src/app/api/auth/session/route.ts";
import { POST as acceptPOST } from "../src/app/api/cleaner/bookings/[id]/accept/route.ts";

function post(handler, url, body) {
  return handler(
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function register(body) {
  return post(registerPOST, "/api/auth/register", body);
}

/** Turns a response's Set-Cookie headers into a request Cookie header. */
function cookieFrom(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function nextWeekday(weekday) {
  let date = addDaysToDateString(localDateString(), 1);
  while (getDayOfWeekFromDateString(date) !== weekday) {
    date = addDaysToDateString(date, 1);
  }
  return date;
}

describe("Self-registration and a fresh database", () => {
  let testDb;

  beforeEach(() => {
    testDb = new DatabaseSync(":memory:");
    resetDatabaseForTesting(testDb);
    getDatabase();
  });

  afterEach(() => {
    resetDatabaseForTesting();
    try {
      testDb.close();
    } catch {}
  });

  test("A fresh database has only the admin and no bookable days", () => {
    const users = getDatabase().prepare("SELECT email, role FROM users").all();
    assert.deepStrictEqual(
      users.map((u) => ({ ...u })),
      [{ email: "admin@saiping.com", role: "admin" }],
    );
    for (const day of listAvailableDays(undefined, 14)) {
      assert.deepStrictEqual(day.availableSlots, []);
    }
  });

  test("A new customer can register and is signed in straight away", async () => {
    const res = await register({
      name: "Nok Customer",
      email: "  Nok@Example.com ",
      password: "cleanhome1",
      role: "customer",
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.redirectUrl, "/bookings");
    assert.strictEqual(data.user.email, "nok@example.com");

    const cookie = cookieFrom(res);
    assert.match(cookie, /session_token=/);
    const session = await sessionGET(
      new Request("http://localhost/api/auth/session", { headers: { cookie } }),
    );
    assert.strictEqual(session.status, 200);
    assert.strictEqual((await session.json()).user.role, "customer");

    const login = await post(loginPOST, "/api/auth/login", {
      email: "nok@example.com",
      password: "cleanhome1",
    });
    assert.strictEqual(login.status, 200);
  });

  test("A new cleaner gets a working schedule and can accept jobs", async () => {
    const res = await register({
      name: "Ploy Cleaner",
      email: "ploy@example.com",
      password: "sparkle2026",
      role: "cleaner",
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual((await res.json()).redirectUrl, "/dashboard/cleaner");

    const user = getUserByEmail("ploy@example.com");
    assert.match(user.cleanerId, /^cleaner-/);

    // Weekdays become bookable once a cleaner exists; weekends stay closed
    const tuesday = nextWeekday(2);
    const sunday = nextWeekday(0);
    const days = listAvailableDays(undefined, 14);
    assert.ok(days.find((d) => d.date === tuesday).availableSlots.length > 0);
    assert.deepStrictEqual(days.find((d) => d.date === sunday).availableSlots, []);

    const booking = createBooking({
      name: "Nok Customer",
      email: "nok@example.com",
      serviceId: "essential",
      date: tuesday,
      time: "09:00",
      address: "1 Sukhumvit Rd",
    });
    assert.strictEqual(booking.status, "created");

    const accept = await acceptPOST(
      new Request(`http://localhost/api/cleaner/bookings/${booking.booking.id}/accept`, {
        method: "POST",
        headers: { cookie: cookieFrom(res) },
      }),
      { params: Promise.resolve({ id: booking.booking.id }) },
    );
    assert.strictEqual(accept.status, 200);
  });

  test("Nobody can register an admin account", async () => {
    const res = await register({
      name: "Sneaky",
      email: "boss@example.com",
      password: "password123",
      role: "admin",
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(getUserByEmail("boss@example.com"), null);
  });

  test("Duplicate emails are rejected, including the admin's", async () => {
    const body = { name: "A", email: "dup@example.com", password: "password123", role: "customer" };
    assert.strictEqual((await register(body)).status, 201);
    assert.strictEqual((await register({ ...body, role: "cleaner" })).status, 409);
    assert.strictEqual(
      (await register({ ...body, email: "ADMIN@saiping.com" })).status,
      409,
    );
  });

  test("Invalid sign-up details get clear 400 errors", async () => {
    const valid = { name: "Nok", email: "nok@example.com", password: "password123", role: "customer" };
    const cases = [
      [{ ...valid, password: "short1" }, /at least 8/],
      [{ ...valid, password: "onlyletters" }, /letter and one number/],
      [{ ...valid, email: "not-an-email" }, /valid email/],
      [{ ...valid, name: "   " }, /your name/],
      [{ ...valid, role: "manager" }, /customer or a cleaner/],
    ];
    for (const [body, message] of cases) {
      const res = await register(body);
      assert.strictEqual(res.status, 400, JSON.stringify(body));
      assert.match((await res.json()).error, message);
    }
  });
});
