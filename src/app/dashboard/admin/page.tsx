"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  AdminCleanerSummary,
  AdminCustomerSummary,
  AdminReview,
  CustomerBooking,
  User,
} from "@/lib/booking-store";
import { signOut, useSession } from "@/lib/use-session";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Stars({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span className="rated-stars" aria-label={`${value} out of 5 stars`}>
      {"★".repeat(rounded)}
      {"☆".repeat(5 - rounded)}
    </span>
  );
}

function displayDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function displayPrice(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type AdminBooking = CustomerBooking & { customerName?: string };

export default function AdminDashboardPage() {
  const session = useSession({
    allowedRoles: ["admin"],
    loginRedirect: "/dashboard/admin",
  });
  const adminUser = session.user;
  const authStatus = session.status === "ready" ? "authenticated" : "loading";

  const [activeTab, setActiveTab] = useState<
    "bookings" | "cleaners" | "customers" | "reviews" | "users"
  >("bookings");
  const [cleaners, setCleaners] = useState<AdminCleanerSummary[]>([]);
  const [customers, setCustomers] = useState<AdminCustomerSummary[]>([]);
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [stats, setStats] = useState({
    totalBookings: 0,
    scheduledBookings: 0,
    completedBookings: 0,
    totalUsers: 0,
    totalRevenueCents: 0,
  });
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [actionMessage, setActionMessage] = useState("");
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // Load platform data
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const controller = new AbortController();

    Promise.all([
      fetch("/api/admin/bookings", { cache: "no-store", signal: controller.signal }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch("/api/admin/users", { cache: "no-store", signal: controller.signal }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch("/api/admin/overview", { cache: "no-store", signal: controller.signal }).then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([bookingData, userData, overview]) => {
        if (overview) {
          setCleaners(overview.cleaners ?? []);
          setCustomers(overview.customers ?? []);
          setReviews(overview.reviews ?? []);
        }
        if (bookingData) {
          setStats(bookingData.stats);
          setBookings(bookingData.bookings ?? []);
        }
        if (userData) {
          setUsers(userData.users ?? []);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setActionMessage("Error: could not refresh administrative records.");
      });

    return () => controller.abort();
  }, [authStatus, refresh]);

  async function handleToggleUserStatus(userItem: User) {
    if (userItem.id === adminUser?.id) return;
    const newStatus = userItem.status === "active" ? "suspended" : "active";

    setUpdatingUserId(userItem.id);
    setActionMessage("");

    try {
      const res = await fetch(`/api/admin/users/${userItem.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;

      if (!res.ok || !data?.success) {
        throw new Error(data?.error ?? "Failed to update account status.");
      }

      setActionMessage(
        `User ${userItem.email} successfully ${newStatus === "suspended" ? "suspended" : "activated"}.`,
      );
      setRefresh((v) => v + 1);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Error updating user.");
    } finally {
      setUpdatingUserId(null);
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
          <p>Verifying Admin Authorization…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link className="brand" href="/dashboard/admin" aria-label="Sai Ping home">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <span>Sai Ping</span>
          </Link>
          <span className="role-pill role-pill-admin">ADMIN CONSOLE</span>
        </div>
        <div className="topbar-nav" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span className="topbar-user-email">
            {adminUser?.name} ({adminUser?.email})
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
          <p className="eyebrow">ADMINISTRATIVE CONSOLE</p>
          <h1>Platform Operations & Bookings</h1>
          <p>
            Welcome, <strong>{adminUser?.name}</strong>. Monitor customer bookings, track cleaner
            acceptance status, and manage platform user credentials.
          </p>
        </div>

        {/* Platform Overview Metrics */}
        <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <div className="stat-card">
            <span className="stat-label">TOTAL BOOKINGS</span>
            <strong className="stat-value">{stats.totalBookings}</strong>
            <span className="stat-caption">Platform reservations</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">SCHEDULED</span>
            <strong className="stat-value">{stats.scheduledBookings}</strong>
            <span className="stat-caption">Upcoming cleanings</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">COMPLETED</span>
            <strong className="stat-value" style={{ color: "var(--green)" }}>
              {stats.completedBookings}
            </strong>
            <span className="stat-caption">Finished services</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">REGISTERED USERS</span>
            <strong className="stat-value">{stats.totalUsers}</strong>
            <span className="stat-caption">Active accounts</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">GROSS REVENUE</span>
            <strong className="stat-value">
              {displayPrice(stats.totalRevenueCents)}
            </strong>
            <span className="stat-caption">Completed & scheduled</span>
          </div>
        </div>

        {actionMessage ? (
          <div
            className={actionMessage.includes("Error") ? "form-error" : "success-banner"}
            role="status"
            style={{ margin: "20px 0" }}
          >
            {actionMessage}
          </div>
        ) : null}

        {/* Tab Controls */}
        <nav className="dashboard-tabs" role="tablist" style={{ marginTop: "28px" }}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "bookings"}
            className={`dashboard-tab${activeTab === "bookings" ? " is-active" : ""}`}
            onClick={() => setActiveTab("bookings")}
          >
            <span>All Customer Bookings</span>
            <span className="tab-badge">{bookings.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "cleaners"}
            className={`dashboard-tab${activeTab === "cleaners" ? " is-active" : ""}`}
            onClick={() => setActiveTab("cleaners")}
          >
            <span>Cleaners</span>
            <span className="tab-badge">{cleaners.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "customers"}
            className={`dashboard-tab${activeTab === "customers" ? " is-active" : ""}`}
            onClick={() => setActiveTab("customers")}
          >
            <span>Customers</span>
            <span className="tab-badge">{customers.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "reviews"}
            className={`dashboard-tab${activeTab === "reviews" ? " is-active" : ""}`}
            onClick={() => setActiveTab("reviews")}
          >
            <span>Ratings & Reviews</span>
            <span className="tab-badge">{reviews.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "users"}
            className={`dashboard-tab${activeTab === "users" ? " is-active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            <span>User & Access Management</span>
            <span className="tab-badge">{users.length}</span>
          </button>
        </nav>

        {/* Panel 1: All Bookings Table with Cleaner Acceptance Information */}
        {activeTab === "bookings" ? (
          <section className="tab-panel">
            <div className="table-responsive-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Customer</th>
                    <th>Service & Location</th>
                    <th>Date & Arrival</th>
                    <th>Price</th>
                    <th>Cleaner Acceptance</th>
                    <th>Service Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <strong className="ref-tag">{b.id.slice(0, 8).toUpperCase()}</strong>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <strong>{b.name}</strong>
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>{b.email}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <strong>{b.serviceName}</strong>
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>{b.address}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span>{displayDate(b.date)}</span>
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>{b.time}</span>
                        </div>
                      </td>
                      <td>
                        <strong>{displayPrice(b.priceCents)}</strong>
                      </td>
                      <td>
                        {b.acceptedByName ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span className="status-badge status-badge-accepted">
                              <span className="status-indicator-dot" aria-hidden="true" />
                              Accepted: {b.acceptedByName}
                            </span>
                            {b.acceptedAt ? (
                              <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                                {displayDate(b.acceptedAt.slice(0, 10))}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="status-badge status-badge-pending">
                            <span className="status-indicator-dot" aria-hidden="true" />
                            Awaiting Acceptance
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-badge ${
                            b.status === "completed"
                              ? "status-badge-completed"
                              : "status-badge-scheduled"
                          }`}
                        >
                          <span className="status-indicator-dot" aria-hidden="true" />
                          {b.statusLabel}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {bookings.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--muted)" }}>
                        No bookings on file.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "cleaners" ? (
          <section className="tab-panel">
            <div className="table-responsive-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Cleaner</th>
                    <th>Available Days</th>
                    <th>Upcoming Jobs</th>
                    <th>Completed</th>
                    <th>Earnings</th>
                    <th>Rating</th>
                    <th>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {cleaners.map((c) => (
                    <tr key={c.userId}>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <strong>{c.name}</strong>
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>{c.email}</span>
                        </div>
                      </td>
                      <td>
                        <div className="weekday-chips">
                          {WEEKDAY_SHORT.map((label, day) => (
                            <span
                              key={label}
                              className={`weekday-chip${c.availableDays.includes(day) ? " is-on" : ""}`}
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>{c.upcomingJobs}</td>
                      <td>{c.completedJobs}</td>
                      <td>
                        <strong>{displayPrice(c.earningsCents)}</strong>
                      </td>
                      <td>
                        {c.averageRating === null ? (
                          <span style={{ fontSize: "12px", color: "var(--muted)" }}>No ratings yet</span>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <Stars value={c.averageRating} />
                            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                              {c.averageRating.toFixed(1)} from {c.reviewCount} review{c.reviewCount === 1 ? "" : "s"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-pill ${
                            c.status === "suspended" ? "status-pill-suspended" : "status-pill-active"
                          }`}
                        >
                          {c.status === "suspended" ? "Suspended" : "Active"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {cleaners.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--muted)" }}>
                        No cleaner accounts yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "customers" ? (
          <section className="tab-panel">
            <div className="table-responsive-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Bookings</th>
                    <th>Upcoming</th>
                    <th>Completed</th>
                    <th>Total Spent</th>
                    <th>Last Service</th>
                    <th>Reviews</th>
                    <th>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.email}>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <strong>{c.name}</strong>
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>{c.email}</span>
                        </div>
                      </td>
                      <td>{c.totalBookings}</td>
                      <td>{c.upcomingBookings}</td>
                      <td>{c.completedBookings}</td>
                      <td>
                        <strong>{displayPrice(c.totalSpentCents)}</strong>
                      </td>
                      <td>{c.lastServiceDate ? displayDate(c.lastServiceDate) : "—"}</td>
                      <td>{c.reviewsWritten}</td>
                      <td>
                        <span
                          className={`status-pill ${
                            c.status === "suspended"
                              ? "status-pill-suspended"
                              : c.status === "guest"
                                ? "status-pill-guest"
                                : "status-pill-active"
                          }`}
                        >
                          {c.status === "suspended" ? "Suspended" : c.status === "guest" ? "Guest" : "Active"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {customers.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "var(--muted)" }}>
                        No customers yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "reviews" ? (
          <section className="tab-panel">
            {reviews.length === 0 ? (
              <div className="empty-bookings-card">
                <div className="empty-icon-circle" aria-hidden="true">
                  ★
                </div>
                <h3>No reviews yet</h3>
                <p>Customer ratings and reviews appear here once completed cleanings are rated.</p>
              </div>
            ) : (
              <div className="review-list">
                {reviews.map((r) => (
                  <article key={r.bookingId} className="review-card">
                    <div className="review-card-header">
                      <Stars value={r.stars} />
                      <span className="review-meta">{displayDate(r.createdAt.slice(0, 10))}</span>
                    </div>
                    <p className="review-text">
                      {r.review ? `“${r.review}”` : <em style={{ color: "var(--muted)" }}>No written review</em>}
                    </p>
                    <p className="review-meta">
                      <strong>{r.customerName}</strong> rated <strong>{r.cleanerName}</strong> ·{" "}
                      {r.serviceName} on {displayDate(r.serviceDate)}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {/* Panel 2: User Account Management */}
        {activeTab === "users" ? (
          <section className="tab-panel">
            <div className="table-responsive-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Account Status</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === adminUser?.id;
                    const isSuspended = u.status === "suspended";

                    return (
                      <tr key={u.id}>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <strong>{u.name}</strong>
                            <span style={{ fontSize: "12px", color: "var(--muted)" }}>{u.email}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`role-pill role-pill-${u.role}`}>
                            {u.role.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`status-pill ${
                              isSuspended ? "status-pill-suspended" : "status-pill-active"
                            }`}
                          >
                            {isSuspended ? "Suspended" : "Active"}
                          </span>
                        </td>
                        <td>{displayDate(u.createdAt)}</td>
                        <td>
                          {isSelf ? (
                            <span style={{ fontSize: "12px", color: "var(--muted)", fontStyle: "italic" }}>
                              Current User
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={isSuspended ? "action-btn-activate" : "action-btn-suspend"}
                              disabled={updatingUserId === u.id}
                              onClick={() => handleToggleUserStatus(u)}
                            >
                              {updatingUserId === u.id
                                ? "Updating…"
                                : isSuspended
                                  ? "Activate Account"
                                  : "Suspend Account"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
