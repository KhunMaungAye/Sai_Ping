# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sai Ping is a home-cleaning booking app (Next.js 16 App Router + React 19 + SQLite via `node:sqlite`) with three roles: customer, cleaner, admin.

## Next.js version warning (from AGENTS.md)

This is Next.js 16.4 with `cacheComponents` and `partialPrefetching` enabled (`next.config.ts`). APIs and conventions differ from older Next.js. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code. `next dev` re-adds the block in `AGENTS.md`; leave it alone.

## Commands

Requires Node >= 22.13 (`node:sqlite` and native TypeScript type stripping are used by both the app and the tests).

```bash
npm run dev        # dev server on http://localhost:3000
npm run build      # production build (also type-checks)
npm run lint       # eslint (next core-web-vitals + typescript)
npm test           # node --test tests/*.test.mjs
npx tsc --noEmit   # type-check only
```

Run one test file or one test:

```bash
node --test tests/auth.test.mjs
node --test --test-name-pattern="accepted by one cleaner" tests/roles-features.test.mjs
```

Only one account is seeded: the admin, `admin@saiping.com` / `AdminPassword123!`. Customers and cleaners sign up through `POST /api/auth/register` (the home page Login pop-up or `/login` → Create account); admin can never be registered. A fresh database therefore has no bookable days until a cleaner signs up.

## Architecture

### Data layer: `src/lib/booking-store.ts`
All persistence lives here: schema creation, migrations, seed data, and every query. There is no ORM.
- `getDatabase()` opens `data/bookings.sqlite` (or `DATABASE_PATH`) once and caches it on `globalThis`. Schema changes run in `initDatabaseSchema` only when a process first opens the DB, so **restart the dev server after changing the schema**; hot reload keeps the old connection.
- Migrations are additive: `PRAGMA table_info` checks followed by `ALTER TABLE ... ADD COLUMN`. Seed rows use `INSERT OR IGNORE`.
- Writes that must be atomic use `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` by hand.
- `bookings` has `UNIQUE (service_date, time_slot)`: each arrival window (`TIME_SLOTS` in `src/lib/services.ts`: 09:00 and 14:00) can be booked once platform-wide.
- New bookings get `cleaner_id = DEFAULT_CLEANER.id` as a placeholder. A booking is only *assigned* once `accepted_by_id` is set by a cleaner accepting it. Cleaner job lists, completion permission and admin cleaner stats all key off `accepted_by_id`, not `cleaner_id`.
- Cleaner working days are stored as `cleaners.available_days` (comma-separated weekdays, 0 = Sunday). A date is bookable only if some *active* cleaner user works that weekday (`getServicedWeekdays`). This is enforced in `listAvailableSlots`, `createBooking` (returns `status: "no-cleaner"`) and both recurring-booking paths.
- Ratings (`ratings` table) hold one 1–5 star rating plus optional `review` text per completed booking.

Date math uses UTC-based helpers in `src/lib/date-utils.ts` on `YYYY-MM-DD` strings to avoid timezone shifts. Use them instead of `Date` arithmetic.

### Auth: `src/lib/auth.ts`
- Sessions live in the SQLite `sessions` table; the token is sent in the `session_token` HttpOnly cookie (customers also get a legacy `customer_session` cookie).
- Route handlers call `requireRole(request, [...roles])`, which returns `{ user }` or `{ error, status }` (401 when not signed in, 403 for the wrong role). Never trust a role sent by the client.
- `getAuthenticatedUser` also accepts legacy fallbacks (Bearer token, `x-session-token`, a raw email as token, `x-customer-email`) that the older test suites depend on. Don't remove them without updating `tests/`.
- A cleaner's id for bookings is `user.cleanerId || user.id`.

### API routes: `src/app/api/**/route.ts`
Plain `Request` → `Response.json` handlers, usually with `Cache-Control: no-store`. **Import lib code with relative paths that include the `.ts` extension** (e.g. `../../../../lib/auth.ts`), not the `@/` alias. The tests import route handlers directly under plain Node, which can't resolve `@/`. Client components may use `@/`.

### Pages: client components
Every page is a `"use client"` component that fetches its data from the API in effects. There is no server-side auth or middleware; access control is enforced only by the API routes.
- `src/lib/use-session.ts` → `useSession({ allowedRoles, loginRedirect })` loads `/api/auth/session` and redirects to `/login` or `/unauthorized`. It deliberately ignores aborted requests: React runs effects twice in development, and treating the aborted first fetch as "signed out" previously caused an endless `/login` ↔ dashboard redirect loop. Any new fetch effect should bail with `if (controller.signal.aborted) return;` in its `catch`.
- `/` is the public home page (`src/app/home-page.tsx`). Its Login button opens `AuthModal`, which wraps the same `AuthPanel` (`src/app/components/`) that `/login` renders. `/dashboard` renders `src/app/role-router.tsx`, which sends users to their role's page: customer → `/bookings`, cleaner → `/dashboard/cleaner`, admin → `/dashboard/admin` (`dashboardPathFor`).
- Styling is mostly hand-written classes in `src/app/globals.css` plus inline styles. Theme colours are CSS variables on `:root` (`--green`, `--ink`, `--muted`, `--line`, `--accent`, …). Check for existing class names before adding new ones: the file is large and collisions have happened (e.g. `.day-option`).

### Tests: `tests/*.test.mjs`
`node:test` suites that import `src/lib/*.ts` and route handlers directly. Each test opens a fresh `new DatabaseSync(":memory:")`, installs it with `resetDatabaseForTesting(db)`, then calls `seedTestUsers()` from `tests/helpers/seed-test-users.mjs` to add the demo accounts (`customer@saiping.com` / `CustomerPassword123!`, `cleaner@saiping.com` / `CleanerPassword123!` working every day, `cleaner2@saiping.com` / `Cleaner2Password123!` working Mon–Fri). Requests are built as `new Request(url, { headers: { cookie: "session_token=..." } })` with tokens from `createUserSession(userId)`. Dynamic route handlers take `{ params: Promise.resolve({ id }) }`.

## Gotchas
- The project sits in a Desktop folder that may be iCloud-synced. Duplicate files like `routes.d 4.ts` or `BUILD_ID 2` can appear in `.next/` and break `tsc` and `next build`. Deleting `.next` (or just the duplicates) fixes it.
- `data/` and `.next/` are git-ignored; the database is created on first use.
- `BOOKING_ADMIN_KEY` only protects the legacy `/api/bookings/[id]/complete` webhook. Cleaners complete jobs through `/api/cleaner/bookings/[id]/complete`.
