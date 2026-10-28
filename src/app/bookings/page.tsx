"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CustomerBooking } from "@/lib/booking-store";

function displayDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function displayTime(value: string) {
  if (!value) return "";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, minute));
}

function displayPrice(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type TabType = "upcoming" | "previous" | "all";

export default function CustomerBookingsPage() {
  const router = useRouter();
  const [authStatus, setAuthStatus] = useState<
    "loading" | "authenticated" | "unauthorized"
  >("loading");
  const [customerEmail, setCustomerEmail] = useState("");
  const [upcomingBookings, setUpcomingBookings] = useState<CustomerBooking[]>([]);
  const [previousBookings, setPreviousBookings] = useState<CustomerBooking[]>([]);
  const [allBookings, setAllBookings] = useState<CustomerBooking[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("upcoming");
  const [apiError, setApiError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/bookings", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setAuthStatus("unauthorized");
          setUpcomingBookings([]);
          setPreviousBookings([]);
          setAllBookings([]);
          router.replace("/login?redirect=/bookings");
          return;
        }

        if (response.status === 403) {
          router.replace("/unauthorized");
          return;
        }

        const data = (await response.json()) as {
          customer?: { email: string };
          bookings?: CustomerBooking[];
          upcoming?: CustomerBooking[];
          previous?: CustomerBooking[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load bookings.");
        }

        setAuthStatus("authenticated");
        setCustomerEmail(data.customer?.email ?? "");
        setUpcomingBookings(data.upcoming ?? []);
        setPreviousBookings(data.previous ?? []);
        setAllBookings(data.bookings ?? []);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setApiError(
          err instanceof Error ? err.message : "Failed to load bookings.",
        );
      });

    return () => controller.abort();
  }, [refresh, router]);

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Continue client-side sign out
    }
    setCustomerEmail("");
    setUpcomingBookings([]);
    setPreviousBookings([]);
    setAllBookings([]);
    setAuthStatus("unauthorized");
    router.push("/login");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Sai Ping home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Sai Ping</span>
        </Link>
        <span className="topbar-note">A little more room to breathe.</span>
        <div className="topbar-nav" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <Link className="topbar-link" href="/">
            Book a cleaning
          </Link>
          {authStatus === "authenticated" ? (
            <button
              type="button"
              className="inline-button"
              onClick={handleSignOut}
              style={{ color: "var(--muted)", textDecoration: "none" }}
            >
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      <div className="dashboard-container">
        <div className="page-heading">
          <p className="eyebrow">CUSTOMER DASHBOARD</p>
          <h1>My Cleaning Bookings</h1>
          <p>
            {authStatus === "authenticated" && customerEmail
              ? `Signed in as ${customerEmail}. Track your scheduled home cleanings and service history.`
              : "Keep track of your scheduled services and booking history."}
          </p>
        </div>

        {authStatus === "loading" ? (
          <div className="dashboard-loading" role="status">
            <span className="dashboard-spinner" aria-hidden="true" />
            <p>Loading your cleaning bookings…</p>
          </div>
        ) : null}

        {authStatus === "unauthorized" ? (
          <section className="dashboard-auth-card" aria-labelledby="signin-heading">
            <span className="auth-icon" aria-hidden="true">
              ✉
            </span>
            <h2 id="signin-heading">Sign in to view your bookings</h2>
            <p className="auth-description">
              Please sign in with your customer account to view your scheduled appointments and service history.
            </p>

            <Link
              href="/login?redirect=/bookings"
              className="confirm-button auth-submit-btn"
              style={{ display: "grid", placeItems: "center", textDecoration: "none" }}
            >
              Sign in to your account
            </Link>

            <div className="auth-hint">
              <span>Looking to schedule a new clean instead?</span>{" "}
              <Link className="text-link" href="/" style={{ marginTop: 0 }}>
                Book a service
              </Link>
            </div>
          </section>
        ) : null}

        {authStatus === "authenticated" ? (
          <>
            {apiError ? (
              <div className="form-error" role="alert" style={{ marginBottom: "20px" }}>
                <span>{apiError}</span>
                <button
                  type="button"
                  className="inline-button"
                  onClick={() => setRefresh((v) => v + 1)}
                  style={{ marginLeft: "12px" }}
                >
                  Try again
                </button>
              </div>
            ) : null}

            {/* Navigation Tabs */}
            <nav className="dashboard-tabs" role="tablist" aria-label="Bookings Categories">
              <button
                type="button"
                role="tab"
                id="tab-upcoming"
                aria-selected={activeTab === "upcoming"}
                aria-controls="panel-upcoming"
                className={`dashboard-tab${activeTab === "upcoming" ? " is-active" : ""}`}
                onClick={() => setActiveTab("upcoming")}
              >
                <span>Upcoming Cleanings</span>
                <span className="tab-badge">{upcomingBookings.length}</span>
              </button>

              <button
                type="button"
                role="tab"
                id="tab-previous"
                aria-selected={activeTab === "previous"}
                aria-controls="panel-previous"
                className={`dashboard-tab${activeTab === "previous" ? " is-active" : ""}`}
                onClick={() => setActiveTab("previous")}
              >
                <span>Previous Cleanings</span>
                <span className="tab-badge">{previousBookings.length}</span>
              </button>

              <button
                type="button"
                role="tab"
                id="tab-all"
                aria-selected={activeTab === "all"}
                aria-controls="panel-all"
                className={`dashboard-tab${activeTab === "all" ? " is-active" : ""}`}
                onClick={() => setActiveTab("all")}
              >
                <span>All Bookings</span>
                <span className="tab-badge">{allBookings.length}</span>
              </button>
            </nav>

            {/* Tab Panel: Upcoming */}
            {activeTab === "upcoming" ? (
              <section
                id="panel-upcoming"
                role="tabpanel"
                aria-labelledby="tab-upcoming"
                className="tab-panel"
              >
                {upcomingBookings.length === 0 ? (
                  <EmptyBookingsView
                    title="No upcoming cleanings scheduled"
                    description="You don't have any upcoming services scheduled at this time."
                    actionLabel="Book a new cleaning"
                    actionHref="/"
                  />
                ) : (
                  <div className="booking-card-list">
                    {upcomingBookings.map((booking) => (
                      <BookingCard key={booking.id} booking={booking} />
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {/* Tab Panel: Previous */}
            {activeTab === "previous" ? (
              <section
                id="panel-previous"
                role="tabpanel"
                aria-labelledby="tab-previous"
                className="tab-panel"
              >
                {previousBookings.length === 0 ? (
                  <EmptyBookingsView
                    title="No previous cleanings found"
                    description="Your completed and past service records will appear here after cleanings are finished."
                    actionLabel="Schedule your first cleaning"
                    actionHref="/"
                  />
                ) : (
                  <div className="booking-card-list">
                    {previousBookings.map((booking) => (
                      <BookingCard key={booking.id} booking={booking} />
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {/* Tab Panel: All */}
            {activeTab === "all" ? (
              <section
                id="panel-all"
                role="tabpanel"
                aria-labelledby="tab-all"
                className="tab-panel"
              >
                {allBookings.length === 0 ? (
                  <EmptyBookingsView
                    title="No bookings on file"
                    description="No service appointments are associated with this account."
                    actionLabel="Book a cleaning"
                    actionHref="/"
                  />
                ) : (
                  <>
                    <div className="all-section-group">
                      <div className="section-divider-header">
                        <h2>Upcoming Appointments ({upcomingBookings.length})</h2>
                      </div>
                      {upcomingBookings.length > 0 ? (
                        <div className="booking-card-list">
                          {upcomingBookings.map((b) => (
                            <BookingCard key={b.id} booking={b} />
                          ))}
                        </div>
                      ) : (
                        <p className="empty-subtext">No upcoming cleanings.</p>
                      )}
                    </div>

                    <div className="all-section-group" style={{ marginTop: "40px" }}>
                      <div className="section-divider-header">
                        <h2>Previous Services ({previousBookings.length})</h2>
                      </div>
                      {previousBookings.length > 0 ? (
                        <div className="booking-card-list">
                          {previousBookings.map((b) => (
                            <BookingCard key={b.id} booking={b} />
                          ))}
                        </div>
                      ) : (
                        <p className="empty-subtext">No previous cleanings.</p>
                      )}
                    </div>
                  </>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function BookingCard({ booking }: { booking: CustomerBooking }) {
  const isCompleted = booking.status === "completed";

  return (
    <article className="customer-booking-card" aria-label={`${booking.serviceName} on ${booking.date}`}>
      <div className="booking-card-header">
        <div className="service-title-wrap">
          <span className="booking-service-title">{booking.serviceName}</span>
          {booking.subscriptionId ? (
            <span className="cadence-pill">Recurring</span>
          ) : (
            <span className="cadence-pill cadence-pill-single">One-time</span>
          )}
        </div>

        <div className="status-wrap">
          <span
            className={`status-badge ${
              isCompleted ? "status-badge-completed" : "status-badge-scheduled"
            }`}
          >
            <span className="status-indicator-dot" aria-hidden="true" />
            {booking.statusLabel}
          </span>
        </div>
      </div>

      <div className="booking-card-grid">
        <div className="booking-detail-item">
          <span className="detail-label">Service Date</span>
          <strong className="detail-value">{displayDate(booking.date)}</strong>
        </div>

        <div className="booking-detail-item">
          <span className="detail-label">Arrival Window</span>
          <strong className="detail-value">{displayTime(booking.time)}</strong>
        </div>

        <div className="booking-detail-item">
          <span className="detail-label">Assigned Cleaner</span>
          <strong className="detail-value">{booking.cleanerName}</strong>
        </div>

        <div className="booking-detail-item">
          <span className="detail-label">Service Price</span>
          <strong className="detail-value">{displayPrice(booking.priceCents)}</strong>
        </div>

        <div className="booking-detail-item booking-detail-span-full">
          <span className="detail-label">Service Address</span>
          <span className="detail-value-text">{booking.address}</span>
        </div>
      </div>

      <div className="booking-card-footer">
        <div className="booking-ref-id">
          <span>REFERENCE</span>
          <strong>{booking.id.slice(0, 8).toUpperCase()}</strong>
        </div>

        <div className="booking-actions">
          {isCompleted ? (
            booking.rating !== null ? (
              <span className="rated-stars" aria-label={`Rated ${booking.rating} stars`}>
                {"★".repeat(booking.rating)}
                {"☆".repeat(5 - booking.rating)}
                <span className="rated-label">({booking.rating}/5 rated)</span>
              </span>
            ) : (
              <Link
                href={`/rate/${encodeURIComponent(booking.id)}`}
                className="action-button-link"
              >
                Rate your cleaner ★
              </Link>
            )
          ) : (
            <span className="upcoming-hint">Arrival scheduled</span>
          )}
        </div>
      </div>
    </article>
  );
}

function EmptyBookingsView({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div className="empty-bookings-card" role="region" aria-label={title}>
      <div className="empty-icon-circle" aria-hidden="true">
        📅
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <Link href={actionHref} className="confirm-button empty-action-btn">
        {actionLabel}
      </Link>
    </div>
  );
}
