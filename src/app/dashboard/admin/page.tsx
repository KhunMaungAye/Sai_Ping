"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CustomerBooking, User } from "@/lib/booking-store";

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
  const router = useRouter();

  const [authStatus, setAuthStatus] = useState<
    "loading" | "authenticated" | "unauthorized"
  >("loading");
  const [adminUser, setAdminUser] = useState<User | null>(null);

  const [activeTab, setActiveTab] = useState<"bookings" | "users">("bookings");
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

  // Authenticate admin
  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { authenticated?: boolean; user?: User } | null) => {
        if (!data?.authenticated || !data.user) {
          router.replace("/login?redirect=/dashboard/admin");
          return;
        }

        if (data.user.role !== "admin") {
          router.replace("/unauthorized");
          return;
        }

        setAdminUser(data.user);
        setAuthStatus("authenticated");
      })
      .catch(() => {
        router.replace("/login?redirect=/dashboard/admin");
      });

    return () => controller.abort();
  }, [router]);

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
    ])
      .then(([bookingData, userData]) => {
        if (bookingData) {
          setStats(bookingData.stats);
          setBookings(bookingData.bookings ?? []);
        }
        if (userData) {
          setUsers(userData.users ?? []);
        }
      })
      .catch(() => {
        setActionMessage("Could not refresh administrative records.");
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
          <p>Verifying administrative privileges…</p>
        </div>
      </main>
    );
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
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="portal-badge portal-badge-admin">Admin Portal</span>
        </div>
        <div className="topbar-nav" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "13px", color: "var(--muted)" }}>
            {adminUser?.email}
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
          <p className="eyebrow">ADMINISTRATOR CONTROL PANEL</p>
          <h1>Platform Operations & Security</h1>
          <p>
            System-wide oversight for bookings, cleaners, customer accounts, and access management.
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
            <span>All Bookings</span>
            <span className="tab-badge">{bookings.length}</span>
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

        {/* Panel 1: All Bookings Table */}
        {activeTab === "bookings" ? (
          <section className="tab-panel">
            <div className="table-responsive-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Customer</th>
                    <th>Service</th>
                    <th>Date & Arrival</th>
                    <th>Assigned Cleaner</th>
                    <th>Price</th>
                    <th>Status</th>
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
                      <td>{b.serviceName}</td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span>{displayDate(b.date)}</span>
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>{b.time}</span>
                        </div>
                      </td>
                      <td>{b.cleanerName}</td>
                      <td>{displayPrice(b.priceCents)}</td>
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
