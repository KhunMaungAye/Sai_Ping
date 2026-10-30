<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Guidance for any AI coding agent (Codex, Cursor, Copilot, Claude Code, Gemini, …) working in this repository. Humans should start with [README.md](README.md).

## Project in one paragraph

Sai Ping is a home-cleaning booking website for Bangkok, built by a student Agile team. Three roles: **customers** book a cleaning on a day a cleaner works and rate/review the cleaner afterwards; **cleaners** set their working days, accept open requests and mark jobs completed; a single **admin** sees everything and can suspend accounts. Stack: Next.js 16.4 (App Router, `cacheComponents` + `partialPrefetching` on), React 19, TypeScript, SQLite via `node:sqlite`, bcryptjs. No ORM, no external services.

## How the team works

- Work is driven by **user stories on the team's Trello board** (e.g. "US-12 Role-Based Authentication System"). Build one story at a time against its **acceptance criteria**. If you weren't given the story, ask for it rather than guessing scope.
- A story is only done when it meets the team's **Definition of Done**:
  1. All acceptance criteria on the card are met and verified.
  2. Main test cases (happy path, edge cases, error conditions) are tested and pass.
  3. No major blocking bugs or unhandled errors remain.
  4. Code is committed, merged, and peer-reviewed by another team member.
  5. The UI is clear, responsive and usable.
- Work on a feature branch and open a pull request into `main`; a teammate reviews and merges. Never push directly to `main` or force-push shared branches unless the repo owner asks.
- **Do not add AI attribution** to commits or PRs (no `Co-Authored-By:` AI trailers, no "Generated with …" lines). Commits are authored by the team member running the agent.

## Commands

Requires Node.js >= 22.13 (both the app and the tests use `node:sqlite` and Node's native TypeScript type stripping).

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (also type-checks)
npm run lint       # eslint
npm test           # node --test tests/*.test.mjs
npx tsc --noEmit   # type-check only

node --test tests/register.test.mjs                                  # one file
node --test --test-name-pattern="accepted by one cleaner" tests/roles-features.test.mjs  # one test
```

Before calling work finished, run `npm test`, `npm run lint` and `npm run build`, and check UI changes in a browser at phone (375px) and desktop widths.

## Accounts and data

- The app seeds **only the admin**: `admin@saiping.com` / `AdminPassword123!`. Admin accounts can never be registered.
- Customers and cleaners sign up via `POST /api/auth/register` (home page Login pop-up or `/login` → Create account). New cleaners work Mon–Fri by default.
- A fresh database has no bookable days until a cleaner exists.
- The database file is `data/bookings.sqlite` (git-ignored). Delete `data/bookings.sqlite*` with the server stopped to reset.

## Map of the code

```
src/app/page.tsx                  Home page route → components/home-page.tsx
src/app/login/                    Dedicated sign-in page (uses AuthPanel)
src/app/bookings/                 Customer portal (book, track, rate & review)
src/app/dashboard/                /dashboard role router; admin/ and cleaner/ dashboards
src/app/rate/[id]/                Rating page for one booking
src/app/components/               home-page, auth-panel, auth-modal, brand-logo, role-router
src/app/api/**/route.ts           Route handlers
src/app/globals.css               All styles
src/lib/booking-store.ts          Schema, migrations, seed data and every query
src/lib/auth.ts                   Password hashing, sessions, cookies, role guards
src/lib/use-session.ts            Client hook: current user + role redirects
src/lib/services.ts               Service packages, prices, TIME_SLOTS
src/lib/date-utils.ts             UTC-safe YYYY-MM-DD helpers
tests/                            node:test suites; tests/helpers/seed-test-users.mjs
```

## Architecture rules

### Data layer (`src/lib/booking-store.ts`)
- `getDatabase()` opens the DB once and caches it on `globalThis`. Schema code runs only when a process first opens the DB, so **restart the dev server after changing the schema**.
- Migrations are additive: check `PRAGMA table_info(...)`, then `ALTER TABLE ... ADD COLUMN`. Seed rows use `INSERT OR IGNORE`.
- Atomic writes use `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` by hand.
- `bookings` has `UNIQUE (service_date, time_slot)`: each arrival window (09:00 and 14:00) can be booked once across the whole platform.
- A booking's `cleaner_id` is a placeholder (`DEFAULT_CLEANER`). It is **assigned** only when a cleaner accepts it and `accepted_by_id` is set. Job lists, completion rights and admin stats all use `accepted_by_id`.
- Cleaner working days live in `cleaners.available_days` (comma-separated weekdays, 0 = Sunday). A date is bookable only if an *active* cleaner works that weekday (`getServicedWeekdays`).
- `ratings` holds one 1–5 star rating plus an optional `review` per completed booking.
- Do date math with `src/lib/date-utils.ts`, not `Date` arithmetic.

### Auth (`src/lib/auth.ts`)
- Sessions are rows in the `sessions` table, sent in the HttpOnly `session_token` cookie (7 days). `sessionCookieHeaders()` builds the cookies for both login and register.
- Every route handler that needs auth calls `requireRole(request, [...roles])`: 401 when signed out, 403 for the wrong role. **Never trust a role sent by the client.**
- `getAuthenticatedUser` keeps some legacy fallbacks (Bearer token, `x-session-token`, raw email, `x-customer-email`) that older tests rely on. Don't remove them without updating `tests/`.
- A cleaner's booking id is `user.cleanerId || user.id`.

### API routes (`src/app/api/**/route.ts`)
- Plain `Request` → `Response.json` handlers, usually with `Cache-Control: no-store`.
- **Import lib code with relative paths that include `.ts`** (e.g. `../../../../lib/auth.ts`), not the `@/` alias, because the tests import route handlers under plain Node. Client components may use `@/`.

### Pages
- Every page is a `"use client"` component that fetches from the API in effects. There is no middleware; the API is the security boundary.
- Use `useSession({ allowedRoles })` from `src/lib/use-session.ts` for role-gated pages. React runs effects twice in development, so a fetch effect's `catch` must bail out on `controller.signal.aborted` and must not treat an aborted request as "signed out". Getting this wrong previously caused an endless login redirect loop.
- Styles are hand-written classes in `globals.css`. Brand tokens on `:root`: `--navy`, `--brand-blue`, `--sunny` (CTA yellow), `--sky`. `--green` is a legacy name for the primary brand blue. The file is large, so **search for a class name before adding one**, because collisions have happened.

### Tests (`tests/*.test.mjs`)
- Each test creates `new DatabaseSync(":memory:")`, installs it with `resetDatabaseForTesting(db)`, then calls `seedTestUsers()` for the demo accounts: `customer@saiping.com` / `CustomerPassword123!`, `cleaner@saiping.com` / `CleanerPassword123!` (every day), `cleaner2@saiping.com` / `Cleaner2Password123!` (Mon–Fri).
- Build requests as `new Request(url, { headers: { cookie: "session_token=..." } })` with a token from `createUserSession(userId)`. Dynamic handlers take `{ params: Promise.resolve({ id }) }`.
- Add tests for every new endpoint or rule, covering the happy path, edge cases and errors.

## Gotchas

- If the repo sits in an iCloud-synced folder, duplicate files such as `.next/types/routes.d 2.ts` can appear and break `tsc`/`next build`. Delete them (or all of `.next/`).
- `BOOKING_ADMIN_KEY` only protects the legacy `/api/bookings/[id]/complete` endpoint. Cleaners complete jobs through `/api/cleaner/bookings/[id]/complete`.
- Home page contact details (Bangkok address, phones, email) are placeholders, and prices are shown in USD.
