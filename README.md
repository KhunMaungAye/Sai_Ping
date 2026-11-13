# Sai Ping

Sai Ping is a home-cleaning booking website, built by our Agile Software Development group. Customers book a cleaning on a day a cleaner is working, cleaners accept the jobs, and customers rate and review the cleaner afterwards. One admin oversees everything.

Built with Next.js 16 (App Router), React 19, TypeScript and SQLite (`node:sqlite`).

## Features

| Role | Where | What they can do |
| --- | --- | --- |
| Visitor | `/` | Read about Sai Ping, its services and Bangkok locations; sign in or create an account from the Login pop-up |
| Customer | `/bookings` | Book a one-time, weekly or fortnightly cleaning on an available day (with an AI-recommended cleaner shown at checkout); edit or cancel a one-time booking up to 24 hours ahead; manage a recurring plan (change its schedule/details, pause, skip or cancel a visit); track bookings; rate and review completed cleanings with optional tags |
| Cleaner | `/dashboard/cleaner` | Set working days; accept open requests (first to accept gets the job, blocked if it's too close to another job); check in on arrival or report running late; mark jobs completed; see jobs a customer cancelled; see their reviews and rating |
| Admin | `/dashboard/admin` | See and filter all bookings, cleaners, customers and reviews; reassign a booking to another cleaner; resolve cleaner no-shows; suspend or reactivate accounts |

## Getting started

Requires **Node.js 22.13+** and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The database is created automatically at `data/bookings.sqlite` (ignored by Git).

### Accounts

- **Admin** (the only seeded account): `admin@saiping.com` / `AdminPassword123!`. Admin accounts cannot be registered.
- **Customers and cleaners** sign up themselves: click **Login** → choose **Customer** or **Cleaner** → **Create account**.

A fresh database has no cleaners, so no days are bookable until a cleaner signs up. New cleaners work Monday–Friday until they change it in **My Availability**.

To reset all data, stop the server and delete `data/bookings.sqlite*`.

### Environment variables

None are required locally. See [`.env.example`](.env.example) for the optional ones.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (also type-checks) |
| `npm start` | Run the production build |
| `npm run lint` | ESLint |
| `npm test` | Run all tests (`node --test`) |

## Project structure

```
src/
├── app/
│   ├── page.tsx              # Home page (/)
│   ├── login/                # Dedicated sign-in page
│   ├── bookings/             # Customer portal
│   ├── dashboard/            # /dashboard role router + admin & cleaner dashboards
│   ├── rate/[id]/            # Rating page for one booking
│   ├── unauthorized/         # Shown when a role opens another role's page
│   ├── components/           # Shared UI: home page, auth panel/modal, logo, role router
│   ├── api/                  # Route handlers (auth, bookings, cleaner, admin, availability)
│   └── globals.css           # Styles and brand colours
└── lib/
    ├── booking-store.ts      # SQLite schema, migrations and all queries
    ├── auth.ts               # Passwords, sessions, role guards
    ├── use-session.ts        # Client hook for the signed-in user
    ├── services.ts           # Service packages, prices and time slots
    ├── date-utils.ts         # Timezone-safe date helpers
    ├── admin-bookings.ts     # Admin booking-filter helpers (status, labels)
    ├── booking-badges.ts     # Status badge shown on a customer's booking
    ├── booking-form.ts       # Shared booking-form validation messages
    ├── cleaner-ratings.ts    # Sorting/formatting cleaner rating summaries
    ├── review-tags.ts        # Feedback tags a customer can add to a rating
    ├── service-specs.ts      # Per-service prep details for cleaners
    ├── subscription-changes.ts  # Validation for editing a recurring plan
    ├── travel-time.ts        # The 60-minute between-jobs travel rule
    └── visit-response.ts     # Shared response mapping for cleaner job updates
tests/                        # node:test suites (+ helpers/ with demo test accounts)
public/brand/                 # Sai Ping logo and mascot
```

## How it works

- **Sign-in:** sessions are stored in SQLite and sent as an `HttpOnly` cookie that lasts 7 days. Passwords are hashed with bcrypt. Every API route checks the user's role on the server (401 when signed out, 403 for the wrong role).
- **Bookings:** each day has two arrival windows, 9:00 and 14:00. Each window can be booked once across the whole platform. A day is bookable only when an active cleaner works that weekday.
- **Jobs:** a booking is assigned to the first cleaner who accepts it, and only that cleaner can mark it completed. A cleaner can't accept a job that starts less than 60 minutes after another one of their jobs ends.
- **Changing a booking:** a customer can edit or cancel a one-time booking up to 24 hours before the visit. If a cleaner had already accepted it, changing the date or time reopens it as a new request.
- **Recurring plans:** a customer can change a plan's schedule and details, pause it, or skip a single visit; each change needs the same lead time and cleaner availability as a new booking.
- **Reviews:** the customer who made the booking can leave one 1–5★ rating, with an optional review and feedback tags (e.g. "Punctual," "Detailed"), after the job is completed.

## API

| Endpoint | Method | Who |
| --- | --- | --- |
| `/api/auth/register` | POST | Public (customer or cleaner only) |
| `/api/auth/login`, `/api/auth/logout`, `/api/auth/session` | POST / POST / GET | Public |
| `/api/availability/days`, `/api/availability` | GET | Public |
| `/api/bookings` | GET, POST | GET: customer. POST: anyone (a signed-in customer always books under their own account) |
| `/api/bookings/[id]/cancel` | POST | The booking's customer (real session only) |
| `/api/bookings/[id]/edit` | POST | The booking's customer (real session only) |
| `/api/bookings/[id]/rating` | GET, POST | The booking's customer (GET also admin) |
| `/api/bookings/[id]/complete` | POST | Legacy, key-protected (`BOOKING_ADMIN_KEY`); cleaners use the endpoint below instead |
| `/api/customer/bookings` | GET | Customer (alias of `/api/bookings` GET) |
| `/api/customer/subscriptions` | GET | Customer |
| `/api/subscriptions` | GET, POST | Public (checks availability / creates a recurring plan) |
| `/api/subscriptions/[id]/pause`, `/resume`, `/skip`, `/update` | POST | The plan's customer |
| `/api/recommendation` | GET | Customer (the AI-recommended cleaner for a date/time) |
| `/api/cleaner/bookings` | GET | Cleaner, Admin |
| `/api/cleaner/bookings/[id]` | GET | Cleaner (job preparation details) |
| `/api/cleaner/bookings/[id]/accept` | POST | Cleaner |
| `/api/cleaner/bookings/[id]/complete` | POST | Cleaner who accepted it, Admin |
| `/api/cleaner/bookings/[id]/check-in`, `/running-late` | POST | Cleaner |
| `/api/cleaner/availability` | GET, PUT | Cleaner |
| `/api/cleaner/reviews` | GET | Cleaner |
| `/api/admin/overview`, `/api/admin/bookings`, `/api/admin/users` | GET | Admin |
| `/api/admin/bookings/[id]/reassign` | GET, POST | Admin |
| `/api/admin/no-shows` | GET | Admin |
| `/api/admin/no-shows/[id]/resolve` | POST | Admin |
| `/api/admin/users/[id]/status` | POST | Admin |

## Testing

```bash
npm test                                  # all suites
node --test tests/register.test.mjs       # one suite
```

Tests run against an in-memory database. `tests/helpers/seed-test-users.mjs` adds the demo customer and cleaner accounts they use.

## Deployment note

SQLite needs a persistent disk for the `data/` directory. Serverless hosts with temporary filesystems will lose bookings.
