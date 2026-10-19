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
