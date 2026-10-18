# Sai_Ping

Morrow is a home-cleaning booking app built with React, Next.js, and SQLite.

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
```

## Booking rules

- The booking page and server share the service names and prices in `src/lib/services.ts`.
- Two arrival windows are offered per date: 9:00 AM and 2:00 PM, in the server's local timezone.
- A SQLite write transaction re-checks a slot before inserting. A unique date/time constraint prevents duplicate reservations, including simultaneous requests.
- SQLite is suitable for local development and a single persistent server. Deployments need a persistent disk mounted for the `data` directory; ephemeral serverless filesystems will not retain bookings.
