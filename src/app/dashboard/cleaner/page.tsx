"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CustomerBooking } from "@/lib/booking-store";
import { signOut, useSession } from "@/lib/use-session";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayOf(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

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

export default function CleanerDashboardPage() {
  const router = useRouter();

  const session = useSession({
    allowedRoles: ["cleaner"],
    loginRedirect: "/dashboard/cleaner",
  });
  const cleanerUser = session.user;
  const authStatus = session.status === "ready" ? "authenticated" : "loading";

  const [bookings, setBookings] = useState<CustomerBooking[]>([]);
  const [availableRequests, setAvailableRequests] = useState<CustomerBooking[]>([]);
  const [availableDays, setAvailableDays] = useState<number[]>([]);
  const [draftDays, setDraftDays] = useState<number[]>([]);
  const [savingDays, setSavingDays] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "available" | "scheduled" | "completed" | "availability"
  >("available");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);
  const [refresh, setRefresh] = useState(0);

  function showStatus(message: string, isError = false) {
    setStatusMessage(message);
    setStatusIsError(isError);
  }

  // Load cleaner bookings and available requests
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const controller = new AbortController();

    fetch("/api/cleaner/bookings", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace("/login?redirect=/dashboard/cleaner");
          return;
        }
        if (res.status === 403) {
          router.replace("/unauthorized");
          return;
        }
        const data = (await res.json()) as {
          bookings?: CustomerBooking[];
          availableRequests?: CustomerBooking[];
          availableDays?: number[];
        };
        setBookings(data.bookings ?? []);
        setAvailableRequests(data.availableRequests ?? []);
        setAvailableDays(data.availableDays ?? []);
        setDraftDays(data.availableDays ?? []);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        showStatus("Could not refresh assigned jobs.", true);
      });

    return () => controller.abort();
  }, [authStatus, refresh, router]);

  async function handleAcceptRequest(bookingId: string) {
    setAcceptingId(bookingId);
    showStatus("");

    try {
      const res = await fetch(`/api/cleaner/bookings/${bookingId}/accept`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        message?: string;
      } | null;

      if (!res.ok || !data?.success) {
        throw new Error(data?.error ?? "Could not accept this booking request.");
      }

      showStatus("Clean request accepted! It is now in your scheduled jobs.");
      setRefresh((v) => v + 1);
      setActiveTab("scheduled");
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Error accepting request.", true);
      setRefresh((v) => v + 1);
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleMarkComplete(bookingId: string) {
    setCompletingId(bookingId);
    showStatus("");

    try {
      const res = await fetch(`/api/cleaner/bookings/${bookingId}/complete`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;

      if (!res.ok || !data?.success) {
        throw new Error(data?.error ?? "Could not complete this booking.");
      }

      showStatus("Job marked completed. The customer can now rate and review it.");
      setRefresh((v) => v + 1);
      setActiveTab("completed");
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Error completing job.", true);
    } finally {
      setCompletingId(null);
    }
  }

  function toggleDraftDay(day: number) {
    setDraftDays((days) =>
      days.includes(day)
        ? days.filter((d) => d !== day)
        : [...days, day].sort((a, b) => a - b),
    );
  }

  async function handleSaveAvailability() {
    setSavingDays(true);
    showStatus("");
    try {
      const res = await fetch("/api/cleaner/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availableDays: draftDays }),
      });
      const data = (await res.json().catch(() => null)) as {
        availableDays?: number[];
        error?: string;
      } | null;
      if (!res.ok || !data?.availableDays) {
        throw new Error(data?.error ?? "Could not save your availability.");
      }
      setAvailableDays(data.availableDays);
      setDraftDays(data.availableDays);
      showStatus("Availability saved. Customers can now book on your working days.");
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not save your availability.", true);
    } finally {
      setSavingDays(false);
    }
  }

  const handleSignOut = signOut;

  if (session.status === "error") {
    return (
      <main className="app-shell">
        <div className="dashboard-loading" role="alert">
          <p>We couldn&apos;t reach the server to check your sign-in.</p>
          <button type="button" className="inline-button" onClick={session.retry}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (authStatus === "loading") {
    return (
      <main className="app-shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Sai Ping home">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <span>Sai Ping</span>
          </Link>
        </header>
        <div className="dashboard-loading" role="status">
          <span className="dashboard-spinner" aria-hidden="true" />
          <p>Loading Cleaner Dashboard…</p>
        </div>
      </main>
    );
  }

  const scheduledJobs = bookings.filter((b) => b.status === "scheduled");
  const completedJobs = bookings.filter((b) => b.status === "completed");
  const ratedJobs = completedJobs.filter((b) => b.rating !== null);
  const avgRating = ratedJobs.length
    ? (ratedJobs.reduce((acc, cur) => acc + (cur.rating || 0), 0) / ratedJobs.length).toFixed(1)
    : "—";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link className="brand" href="/dashboard/cleaner" aria-label="Sai Ping home">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <span>Sai Ping</span>
          </Link>
          <span className="role-pill role-pill-cleaner">CLEANER PORTAL</span>
        </div>
        <div className="topbar-nav" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span className="topbar-user-email">
            {cleanerUser?.name} ({cleanerUser?.email})
          </span>
          <button
            type="button"
            className="inline-button"
            onClick={handleSignOut}
            style={{ color: "var(--muted)", textDecoration: "none" }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="dashboard-container">
        <div className="page-heading">
          <p className="eyebrow">CLEANER DASHBOARD</p>
          <h1>Cleaning Service Operations</h1>
          <p>
            Welcome, <strong>{cleanerUser?.name}</strong>. Accept pending customer requests, manage
            assigned jobs, and track service completions.
          </p>
        </div>

        {/* Cleaner Summary Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">AVAILABLE REQUESTS</span>
            <strong className="stat-value" style={{ color: "var(--accent)" }}>
              {availableRequests.length}
            </strong>
            <span className="stat-caption">Waiting for cleaner acceptance</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">MY SCHEDULED JOBS</span>
            <strong className="stat-value">{scheduledJobs.length}</strong>
            <span className="stat-caption">Accepted upcoming appointments</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">COMPLETED SERVICES</span>
            <strong className="stat-value" style={{ color: "var(--green)" }}>
              {completedJobs.length}
            </strong>
            <span className="stat-caption">Finished home cleanings</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">AVERAGE RATING</span>
            <strong className="stat-value" style={{ color: "#bb7414" }}>
              ★ {avgRating}
            </strong>
            <span className="stat-caption">
              From {ratedJobs.length} customer review{ratedJobs.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {statusMessage ? (
          <div
            className={statusIsError ? "form-error" : "success-banner"}
            role="status"
            style={{ margin: "20px 0" }}
          >
            {statusMessage}
          </div>
        ) : null}

        {/* Tab Navigation */}
        <nav className="dashboard-tabs" role="tablist" style={{ marginTop: "28px" }}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "available"}
            className={`dashboard-tab${activeTab === "available" ? " is-active" : ""}`}
            onClick={() => setActiveTab("available")}
          >
            <span>Available Requests</span>
            <span className="tab-badge">{availableRequests.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "scheduled"}
            className={`dashboard-tab${activeTab === "scheduled" ? " is-active" : ""}`}
            onClick={() => setActiveTab("scheduled")}
          >
            <span>My Scheduled Jobs</span>
            <span className="tab-badge">{scheduledJobs.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "completed"}
            className={`dashboard-tab${activeTab === "completed" ? " is-active" : ""}`}
            onClick={() => setActiveTab("completed")}
          >
            <span>Completed Jobs</span>
            <span className="tab-badge">{completedJobs.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "availability"}
            className={`dashboard-tab${activeTab === "availability" ? " is-active" : ""}`}
            onClick={() => setActiveTab("availability")}
          >
            <span>My Availability</span>
            <span className="tab-badge">{availableDays.length}d</span>
          </button>
        </nav>

        {/* Tab content */}
        <section className="tab-panel">
          {/* TAB 1: Available Customer Requests */}
          {activeTab === "available" && (
            <div>
              {availableRequests.length === 0 ? (
                <div className="empty-bookings-card">
                  <div className="empty-icon-circle" aria-hidden="true">
                    🎉
                  </div>
                  <h3>No pending requests</h3>
                  <p>All current customer cleaning requests have been accepted by cleaners.</p>
                </div>
              ) : (
                <div className="booking-card-list">
                  {availableRequests.map((req) => {
                    const worksThatDay = availableDays.includes(weekdayOf(req.date));
                    return (
                    <article key={req.id} className="customer-booking-card" style={{ borderLeft: "4px solid var(--accent)" }}>
                      <div className="booking-card-header">
                        <div className="service-title-wrap">
                          <span className="booking-service-title">{req.serviceName}</span>
                          <span className="field-hint">Customer: {req.name}</span>
                        </div>
                        <span className="status-badge status-badge-pending">
                          <span className="status-indicator-dot" aria-hidden="true" />
                          New Request
                        </span>
                      </div>

                      <div className="booking-card-grid">
                        <div className="booking-detail-item">
                          <span className="detail-label">Service Date</span>
                          <strong className="detail-value">{displayDate(req.date)}</strong>
                        </div>

                        <div className="booking-detail-item">
                          <span className="detail-label">Arrival Window</span>
                          <strong className="detail-value">{displayTime(req.time)}</strong>
                        </div>

                        <div className="booking-detail-item booking-detail-span-full">
                          <span className="detail-label">Service Location</span>
                          <span className="detail-value-text">{req.address}</span>
                        </div>

                        <SpecialInstructions note={req.specialInstructions} />

                        <div className="booking-detail-item">
                          <span className="detail-label">Customer Contact</span>
                          <span className="detail-value-text">{req.email}</span>
                        </div>

                        <div className="booking-detail-item">
                          <span className="detail-label">Service Payout</span>
                          <strong className="detail-value" style={{ color: "var(--green)" }}>
                            {displayPrice(req.priceCents)}
                          </strong>
                        </div>
                      </div>

                      <div className="booking-card-footer">
                        <div className="booking-ref-id">
                          <span>REF</span>
                          <strong>{req.id.slice(0, 8).toUpperCase()}</strong>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {!worksThatDay ? (
                            <span className="upcoming-hint" style={{ color: "#b46b0a" }}>
                              You don&apos;t work {WEEKDAYS[weekdayOf(req.date)]}s
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="confirm-button"
                            style={{
                              margin: 0,
                              padding: "10px 20px",
                              minHeight: "38px",
                              fontSize: "13px",
                              fontWeight: 600,
                              width: "auto",
                            }}
                            disabled={acceptingId === req.id || !worksThatDay}
                            onClick={() => handleAcceptRequest(req.id)}
                          >
                            {acceptingId === req.id ? "Accepting…" : "Accept Clean Request ✓"}
                          </button>
                        </div>
                      </div>
                    </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Scheduled Jobs */}
          {activeTab === "scheduled" && (
            <div>
              {scheduledJobs.length === 0 ? (
                <div className="empty-bookings-card">
                  <div className="empty-icon-circle" aria-hidden="true">
                    ✨
                  </div>
                  <h3>No scheduled jobs pending</h3>
                  <p>You have no scheduled appointments currently. Check Available Requests to accept new jobs!</p>
                </div>
              ) : (
                <div className="booking-card-list">
                  {scheduledJobs.map((job) => (
                    <article key={job.id} className="customer-booking-card">
                      <div className="booking-card-header">
                        <div className="service-title-wrap">
                          <span className="booking-service-title">{job.serviceName}</span>
                          <span className="field-hint">Customer: {job.name}</span>
                        </div>
                        <span className="status-badge status-badge-scheduled">
                          <span className="status-indicator-dot" aria-hidden="true" />
                          Accepted & Scheduled
                        </span>
                      </div>

                      <div className="booking-card-grid">
                        <div className="booking-detail-item">
                          <span className="detail-label">Service Date</span>
                          <strong className="detail-value">{displayDate(job.date)}</strong>
                        </div>

                        <div className="booking-detail-item">
                          <span className="detail-label">Arrival Window</span>
                          <strong className="detail-value">{displayTime(job.time)}</strong>
                        </div>

                        <div className="booking-detail-item booking-detail-span-full">
                          <span className="detail-label">Service Location</span>
                          <span className="detail-value-text">{job.address}</span>
                        </div>

                        <SpecialInstructions note={job.specialInstructions} />

                        <div className="booking-detail-item booking-detail-span-full">
                          <span className="detail-label">Customer Contact</span>
                          <span className="detail-value-text">{job.email}</span>
                        </div>
                      </div>

                      <div className="booking-card-footer">
                        <div className="booking-ref-id">
                          <span>REF</span>
                          <strong>{job.id.slice(0, 8).toUpperCase()}</strong>
                        </div>

                        <div>
                          <button
                            type="button"
                            className="confirm-button"
                            style={{
                              margin: 0,
                              padding: "8px 16px",
                              minHeight: "36px",
                              fontSize: "12px",
                              width: "auto",
                            }}
                            disabled={completingId === job.id}
                            onClick={() => handleMarkComplete(job.id)}
                          >
                            {completingId === job.id ? "Updating…" : "Mark as Completed ✓"}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Completed Jobs */}
          {activeTab === "completed" && (
            <div>
              {completedJobs.length === 0 ? (
                <div className="empty-bookings-card">
                  <div className="empty-icon-circle" aria-hidden="true">
                    📋
                  </div>
                  <h3>No completed jobs yet</h3>
                  <p>Completed services will be archived here once you finish a cleaning appointment.</p>
                </div>
              ) : (
                <div className="booking-card-list">
                  {completedJobs.map((job) => (
                    <article key={job.id} className="customer-booking-card">
                      <div className="booking-card-header">
                        <div className="service-title-wrap">
                          <span className="booking-service-title">{job.serviceName}</span>
                          <span className="field-hint">Customer: {job.name}</span>
                        </div>
                        <span className="status-badge status-badge-completed">
                          <span className="status-indicator-dot" aria-hidden="true" />
                          Completed
                        </span>
                      </div>

                      <div className="booking-card-grid">
                        <div className="booking-detail-item">
                          <span className="detail-label">Service Date</span>
                          <strong className="detail-value">{displayDate(job.date)}</strong>
                        </div>

                        <div className="booking-detail-item">
                          <span className="detail-label">Arrival Window</span>
                          <strong className="detail-value">{displayTime(job.time)}</strong>
                        </div>

                        <div className="booking-detail-item booking-detail-span-full">
                          <span className="detail-label">Service Location</span>
                          <span className="detail-value-text">{job.address}</span>
                        </div>

                        <SpecialInstructions note={job.specialInstructions} />

                        <div className="booking-detail-item">
                          <span className="detail-label">Customer Contact</span>
                          <span className="detail-value-text">{job.email}</span>
                        </div>

                        <div className="booking-detail-item">
                          <span className="detail-label">Rating</span>
                          {job.rating !== null ? (
                            <>
                              <span className="rated-stars">
                                {"★".repeat(job.rating)}
                                {"☆".repeat(5 - job.rating)}
                                <span className="rated-label">({job.rating}/5)</span>
                              </span>
                              {job.review ? (
                                <p className="submitted-review">“{job.review}”</p>
                              ) : null}
                            </>
                          ) : (
                            <span className="upcoming-hint">Awaiting customer review</span>
                          )}
                        </div>
                      </div>

                      <div className="booking-card-footer">
                        <div className="booking-ref-id">
                          <span>REF</span>
                          <strong>{job.id.slice(0, 8).toUpperCase()}</strong>
                        </div>
                        <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                          Completed cleaning service
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "availability" && (
            <div className="availability-panel">
              <h2>Days you can work</h2>
              <p>
                Customers can only book days when at least one cleaner is available, and you can
                only accept requests that fall on your working days.
              </p>
              <div className="availability-toggles" role="group" aria-label="Working days">
                {WEEKDAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    className="availability-toggle"
                    aria-pressed={draftDays.includes(day)}
                    onClick={() => toggleDraftDay(day)}
                  >
                    {label.slice(0, 3)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="confirm-button"
                style={{ width: "auto", padding: "10px 24px", margin: 0 }}
                disabled={
                  savingDays ||
                  draftDays.join(",") === availableDays.join(",")
                }
                onClick={handleSaveAvailability}
              >
                {savingDays ? "Saving…" : "Save availability"}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/** US-13: the customer's handling notes, or a clear message when there are none. */
function SpecialInstructions({ note }: { note: string | null | undefined }) {
  return (
    <div className="booking-detail-item booking-detail-span-full">
      <span className="detail-label">Special Instructions</span>
      {note ? (
        <p className="special-instructions-note">{note}</p>
      ) : (
        <p className="special-instructions-note is-empty">No special instructions provided.</p>
      )}
    </div>
  );
}
