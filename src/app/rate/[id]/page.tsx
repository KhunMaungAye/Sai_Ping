import { Suspense } from "react";
import Link from "next/link";
import RatingForm from "./rating-form";

export default function RateBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Sai Ping home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Sai Ping</span>
        </Link>
        <span className="topbar-note">Home cleaning, made simple.</span>
        <div className="topbar-nav">
          <Link className="topbar-link" href="/bookings">
            My bookings
          </Link>
        </div>
      </header>
      <Suspense fallback={<p className="rating-message">Loading booking…</p>}>
        <RatingPageContent params={params} />
      </Suspense>
    </main>
  );
}

async function RatingPageContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RatingForm bookingId={id} />;
}
