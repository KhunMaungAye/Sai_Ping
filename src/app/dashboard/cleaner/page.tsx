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

export default function CleanerDashboardPage() {
  const router = useRouter();

  const [authStatus, setAuthStatus] = useState<
    "loading" | "authenticated" | "unauthorized"
  >("loading");
  const [cleanerUser, setCleanerUser] = useState<{
    id: string;
    email: string;
    name: string;
    role: string;
  } | null>(null);

  const [bookings, setBookings] = useState<CustomerBooking[]>([]);
  const [activeTab, setActiveTab] = useState<"scheduled" | "completed" | "all">("scheduled");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [refresh, setRefresh] = useState(0);

  // Check cleaner authentication
  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/auth/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { authenticated?: boolean; user?: { id: string; email: string; name: string; role: string } } | null) => {
        if (!data?.authenticated || !data.user) {
          router.replace("/login?redirect=/dashboard/cleaner");
          return;
        }

        if (data.user.role !== "cleaner" && data.user.role !== "admin") {
          router.replace("/unauthorized");
          return;
        }

        setCleanerUser(data.user);
        setAuthStatus("authenticated");
      })
      .catch(() => {
        router.replace("/login?redirect=/dashboard/cleaner");
      });

    return () => controller.abort();
  }, [router]);

  // Load cleaner bookings
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
        const data = (await res.json()) as { bookings?: CustomerBooking[] };
        setBookings(data.bookings ?? []);
      })
      .catch(() => {
        setStatusMessage("Could not refresh assigned jobs.");
      });

    return () => controller.abort();
  }, [authStatus, refresh, router]);

  async function handleMarkComplete(bookingId: string) {
    setCompletingId(bookingId);
    setStatusMessage("");

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

      setStatusMessage("Job marked completed successfully!");
      setRefresh((v) => v + 1);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Error completing job.");
    } finally {
      setCompletingId(null);
    }
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    router.replace("/login");
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
  const avgRating =
    ratedJobs.length > 0
      ? (
          ratedJobs.reduce((acc, curr) => acc + (curr.rating || 0), 0) /
          ratedJobs.length
        ).toFixed(1)
      : "5.0";

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Sai Ping home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Sai Ping</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="portal-badge portal-badge-cleaner">Cleaner Portal</span>
        </div>
        <div className="topbar-nav" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "13px", color: "var(--muted)" }}>
            {cleanerUser?.name}
          </span>
          <button
            type="button"
            className="inline-button"
            onClick={handleSignOut}
            style={{ color: "var(--coral)", textDecoration: "none" }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="dashboard-container">
        <div className="page-heading">
          <p className="eyebrow">CLEANER DASHBOARD</p>
          <h1>Service Jobs & Schedule</h1>
          <p>
            Welcome back, {cleanerUser?.name}. Manage your assigned appointments and mark completed services.
          </p>
        </div>

        {/* Cleaner Summary Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">ASSIGNED SCHEDULED</span>
            <strong className="stat-value">{scheduledJobs.length}</strong>
            <span className="stat-caption">Upcoming cleaning appointments</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">COMPLETED SERVICES</span>
            <strong className="stat-value">{completedJobs.length}</strong>
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
            className={statusMessage.includes("Error") ? "form-error" : "success-banner"}
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
            aria-selected={activeTab === "scheduled"}
            className={`dashboard-tab${activeTab === "scheduled" ? " is-active" : ""}`}
            onClick={() => setActiveTab("scheduled")}
          >
            <span>Scheduled Jobs</span>
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
            aria-selected={activeTab === "all"}
            className={`dashboard-tab${activeTab === "all" ? " is-active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            <span>All Assigned</span>
            <span className="tab-badge">{bookings.length}</span>
          </button>
        </nav>

        {/* Tab content */}
        <section className="tab-panel">
            {activeTab === "scheduled" && scheduledJobs.length === 0 ? (
              <div className="empty-bookings-card">
                <div className="empty-icon-circle" aria-hidden="true">
                  ✨
                </div>
                <h3>No scheduled jobs pending</h3>
                <p>You have finished all scheduled appointments assigned to you.</p>
              </div>
            ) : null}

            {activeTab === "completed" && completedJobs.length === 0 ? (
              <div className="empty-bookings-card">
                <div className="empty-icon-circle" aria-hidden="true">
                  📋
                </div>
                <h3>No completed jobs yet</h3>
                <p>Completed services will be archived here once you finish a cleaning.</p>
              </div>
            ) : null}

            <div className="booking-card-list">
              {(activeTab === "scheduled"
                ? scheduledJobs
                : activeTab === "completed"
                  ? completedJobs
                  : bookings
              ).map((job) => (
                <article key={job.id} className="customer-booking-card">
                  <div className="booking-card-header">
                    <div className="service-title-wrap">
                      <span className="booking-service-title">{job.serviceName}</span>
                      <span className="field-hint">Customer: {job.name}</span>
                    </div>
                    <span
                      className={`status-badge ${
                        job.status === "completed"
                          ? "status-badge-completed"
                          : "status-badge-scheduled"
                      }`}
                    >
                      <span className="status-indicator-dot" aria-hidden="true" />
                      {job.statusLabel}
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
                      {job.status === "scheduled" ? (
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
                      ) : job.rating !== null ? (
                        <span className="rated-stars">
                          {"★".repeat(job.rating)}
                          {"☆".repeat(5 - job.rating)}
                          <span className="rated-label">({job.rating}/5)</span>
                        </span>
                      ) : (
                        <span className="upcoming-hint">Completed (Awaiting customer review)</span>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
    </main>
  );
}
