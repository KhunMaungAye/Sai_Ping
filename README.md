# Sai_Ping

Sai Ping is a home-cleaning booking app built with React, Next.js, and SQLite.

## Requirements

- Node.js 22.13 or later
- npm

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The SQLite database is created automatically at `data/bookings.sqlite` the first time availability is checked. Local database files are ignored by Git.

## Checks

```bash
npm run lint
npm run build
npm test
```

## Role-Based Authentication System (US-12)

Sai Ping supports role-based authentication with three roles:

- **Customer**: Access to the customer bookings dashboard (`/bookings`), viewing personal appointments, and submitting cleaner ratings.
- **Cleaner**: Access to the cleaner job dashboard (`/dashboard/cleaner`), viewing assigned cleaning jobs, and marking completed cleanings.
- **Admin**: Access to the administrator control panel (`/dashboard/admin`), viewing platform-wide booking metrics, managing bookings, and toggling user account status (Active / Suspended).

### Seed Development Accounts

Pre-seeded accounts are initialized automatically in the SQLite database:

| Role | Email | Password | Assigned Dashboard |
| --- | --- | --- | --- |
| **Customer** | `customer@saiping.com` | `CustomerPassword123!` | `/bookings` |
| **Cleaner** | `cleaner@saiping.com` | `CleanerPassword123!` | `/dashboard/cleaner` (works every day) |
| **Cleaner** | `cleaner2@saiping.com` | `Cleaner2Password123!` | `/dashboard/cleaner` (works Mon–Fri) |
| **Admin** | `admin@saiping.com` | `AdminPassword123!` | `/dashboard/admin` |

### Authentication Architecture

- **Dedicated Sign-in**: Located at `/login`. Features email and password fields, show/hide password toggle, accessible loading states, and redirect preservation.
- **Password Security**: Passwords are saved as bcrypt hashes (`cost factor = 10`) with individual salts. Passwords and hashes are never returned in API responses or logs.
- **Session Persistence**: Sessions are tracked in the SQLite `sessions` table and authenticated via `HttpOnly`, `SameSite=Lax` cookies (`session_token`), with `Secure` flags in production.
- **Role Guards**: Backend route handlers enforce role-based access control. Unauthenticated requests receive `401 Unauthorized`; authenticated requests lacking required roles receive `403 Forbidden`. Client-supplied role query parameters and headers are strictly ignored.
- **Central Role Router**: Navigating to `/dashboard` automatically checks the user's authenticated session and redirects them to their role-specific dashboard.
- **Access Restrictions**: Attempting to access an unauthorized route redirects to `/unauthorized`.
- **Sign Out**: The `/api/auth/logout` endpoint deletes the session record from SQLite and clears the authentication cookies (`Max-Age=0`). Suspended accounts immediately have all sessions revoked.

### Role Permissions & API Endpoints

| Endpoint | Method | Allowed Roles | Description |
| --- | --- | --- | --- |
| `/api/auth/login` | `POST` | Public | Authenticates credentials and sets persistent session cookie |
| `/api/auth/logout` | `POST` | Authenticated | Revokes current session and clears authentication cookies |
| `/api/auth/session` | `GET` | Public | Returns current session status and authenticated user details |
| `/api/bookings` | `GET` | Customer | Returns customer's upcoming and previous bookings |
| `/api/cleaner/bookings` | `GET` | Cleaner, Admin | Returns scheduled jobs assigned to the cleaner |
| `/api/cleaner/bookings/[id]/complete` | `POST` | Cleaner, Admin | Marks assigned cleaning job as completed |
| `/api/admin/bookings` | `GET` | Admin | Returns system-wide booking statistics and reservation history |
| `/api/admin/users` | `GET` | Admin | Returns list of all registered platform user accounts |
| `/api/admin/users/[id]/status` | `POST` | Admin | Updates user account status (`active` / `suspended`) |
| `/api/admin/overview` | `GET` | Admin | Per-cleaner and per-customer summaries plus all ratings and reviews |
| `/api/cleaner/bookings/[id]/accept` | `POST` | Cleaner | Accepts an open request on one of the cleaner's working days |
| `/api/cleaner/availability` | `GET`, `PUT` | Cleaner | Reads or sets the cleaner's working weekdays (`0` = Sunday … `6` = Saturday) |
| `/api/availability/days` | `GET` | Public | Upcoming dates with their open arrival windows |
| `/api/bookings/[id]/rating` | `GET`, `POST` | Customer who booked | Reads or submits a 1–5 star rating with an optional written review |

### Role dashboards

- **Customer** (`/bookings`): books a cleaning by picking from upcoming days that have an open arrival window (a day is bookable only when at least one active cleaner works that weekday), tracks requests, and rates and reviews the cleaner once a job is completed.
- **Cleaner** (`/dashboard/cleaner`): sets working days, accepts open requests (first cleaner to accept gets the job), and marks their own accepted jobs completed. Reviews they receive appear on completed jobs.
- **Admin** (`/dashboard/admin`): sees every booking, each cleaner's availability, jobs, earnings and average rating, each customer's bookings and spend, all reviews, and can suspend or reactivate accounts.

### Automated Test Suites

Run all tests via:
```bash
npm test
```

- **`tests/auth.test.mjs`**: 19 tests covering login validation, bcrypt comparison, session creation, session invalidation on logout, RBAC guards, account suspension, and open redirect defense.
- **`tests/customer-bookings.test.mjs`**: 8 tests covering customer booking retrieval, server-side data isolation, and query-parameter tampering prevention.
- **`tests/recurring-cleaning.test.mjs`**: 11 tests covering recurring weekly/biweekly cleanings, conflict detection, and calendar math.
- **`tests/cleaner-accept.test.mjs`**: 4 tests covering cleaner request acceptance.
- **`tests/roles-features.test.mjs`**: 7 tests covering cleaner availability, accept conflicts, job ownership, review permissions, and the admin overview.

## Recurring cleaning subscriptions

- Customers can choose between single bookings, weekly subscriptions, or biweekly subscriptions.
- Customers select their preferred day of the week and start date, with the next scheduled service date displayed before confirmation.
- Subscriptions support an optional end date (or schedule horizon).
- Cleaner availability across all recurring dates is validated atomically in SQLite (`BEGIN IMMEDIATE;`). If any date is unavailable, no partial bookings are created and the conflict date is returned.
- Duplicate submissions are safeguarded using idempotency keys and transactional locking.
- Date arithmetic handles month, leap year, and year boundaries via UTC calendar math without timezone shifts.

## Booking rules

- The booking page and server share the service names and prices in `src/lib/services.ts`.
- Two arrival windows are offered per date: 9:00 AM and 2:00 PM, in the server's local timezone.
- A SQLite write transaction re-checks a slot before inserting. A unique date/time constraint prevents duplicate reservations, including simultaneous requests.
- SQLite is suitable for local development and a single persistent server. Deployments need a persistent disk mounted for the `data` directory; ephemeral serverless filesystems will not retain bookings.

## Completing a service and collecting a rating

Set a private `BOOKING_ADMIN_KEY` on the server process. Never expose it in a `NEXT_PUBLIC_*` variable or browser code. For local development, start the app with:

```bash
BOOKING_ADMIN_KEY="replace-with-a-private-key" npm run dev
```

After the cleaner finishes the job, an authorized staff tool can mark it complete:

```bash
curl -X POST "http://localhost:3000/api/bookings/<booking-id>/complete" \
	-H "x-admin-key: replace-with-a-private-key" \
	-H "Content-Type: application/json" \
	-d '{"cleanerId":"cleaner-001"}'
```

Customers can open the booking-specific rating link shown on the booking confirmation. The server checks completion again when a rating is submitted and saves one 1–5 star rating linked to that booking and its cleaner.
