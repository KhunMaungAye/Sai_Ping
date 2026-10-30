"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AvailableDay, CustomerBooking } from "@/lib/booking-store";
import {
  SERVICES,
  TIME_SLOTS,
  type BookingTime,
  type ServiceId,
} from "@/lib/services";
import {
  getDayNameFromDateString,
  getNextServiceDate,
} from "@/lib/date-utils";

function dateString(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
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

type TabType = "upcoming" | "previous" | "all" | "book-new";
type ScheduleMode = "one-time" | "weekly" | "biweekly";

export default function CustomerBookingsPage() {
  const router = useRouter();
  const [authStatus, setAuthStatus] = useState<
    "loading" | "authenticated" | "unauthorized"
  >("loading");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [upcomingBookings, setUpcomingBookings] = useState<CustomerBooking[]>([]);
  const [previousBookings, setPreviousBookings] = useState<CustomerBooking[]>([]);
  const [allBookings, setAllBookings] = useState<CustomerBooking[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("upcoming");
  const [apiError, setApiError] = useState("");
  const [bookingSuccessMsg, setBookingSuccessMsg] = useState("");
  const [refresh, setRefresh] = useState(0);

  // Booking Form State
  const [serviceId, setServiceId] = useState<ServiceId>("essential");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("one-time");
  const [minimumDate, setMinimumDate] = useState("");
  const [date, setDate] = useState("");
  const [endDate] = useState("");
  const [preferredDay, setPreferredDay] = useState<string>("Monday");
  const [time, setTime] = useState<BookingTime | "">("");
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [availability, setAvailability] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingFormError, setBookingFormError] = useState("");
  const [days, setDays] = useState<AvailableDay[]>([]);

  const selectedService = SERVICES.find((service) => service.id === serviceId) ?? SERVICES[0];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const today = new Date();
      const minStr = dateString(today);
      setMinimumDate(minStr);
      today.setDate(today.getDate() + 1);
      const tomorrowStr = dateString(today);
      setDate(tomorrowStr);
      setPreferredDay(getDayNameFromDateString(tomorrowStr));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Fetch bookings and customer info
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
          customer?: { email: string; name?: string };
          bookings?: CustomerBooking[];
          upcoming?: CustomerBooking[];
          previous?: CustomerBooking[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load bookings.");
        }

        setAuthStatus("authenticated");
        const email = data.customer?.email ?? "";
        setCustomerEmail(email);
        setName(email.split("@")[0]);
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

  // Fetch current user session to get display name
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const controller = new AbortController();

    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { user?: { name?: string; email?: string } } | null) => {
        if (data?.user?.name) {
          setCustomerName(data.user.name);
          setName(data.user.name);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [authStatus]);

  // Upcoming days with open arrival windows (based on cleaner availability)
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const controller = new AbortController();

    fetch("/api/availability/days?count=21", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { days?: AvailableDay[] } | null) => {
        setDays(data?.days ?? []);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setDays([]);
      });

    return () => controller.abort();
  }, [authStatus, refresh]);

  // Keep the selection on a day that actually has an open arrival window
  const selectedDayIsOpen = days.some(
    (d) => d.date === date && d.availableSlots.length > 0,
  );
  const firstOpenDate = days.find((d) => d.availableSlots.length > 0)?.date;
  useEffect(() => {
    if (selectedDayIsOpen || !firstOpenDate) return;
    const timer = window.setTimeout(() => {
      setDate(firstOpenDate);
      setPreferredDay(getDayNameFromDateString(firstOpenDate));
      setTime("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedDayIsOpen, firstOpenDate]);

  // Availability check effect
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();

    if (scheduleMode === "one-time") {
      fetch(`/api/availability?date=${encodeURIComponent(date)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = (await response.json()) as {
            availableSlots?: string[];
            error?: string;
          };
          if (!response.ok)
            throw new Error(result.error ?? "Availability check failed.");
          setAvailableSlots(result.availableSlots ?? []);
          setAvailability("ready");
        })
        .catch((reason: unknown) => {
          if (reason instanceof Error && reason.name === "AbortError") return;
          setAvailableSlots([]);
          setAvailability("error");
        });
    } else {
      const checkDate = getNextServiceDate(date, preferredDay);
      const checkEnd = endDate ? `&endDate=${encodeURIComponent(endDate)}` : "";
      const checkTime = time || "09:00";
      fetch(
        `/api/subscriptions?startDate=${encodeURIComponent(checkDate)}&frequency=${scheduleMode}&time=${checkTime}&preferredDay=${encodeURIComponent(preferredDay)}${checkEnd}`,
        { cache: "no-store", signal: controller.signal },
      )
        .then(async (response) => {
          const result = (await response.json()) as { available?: boolean };
          if (response.ok && result.available) {
            setAvailableSlots([...TIME_SLOTS]);
          } else {
            setAvailableSlots([]);
          }
          setAvailability("ready");
        })
        .catch((reason: unknown) => {
          if (reason instanceof Error && reason.name === "AbortError") return;
          setAvailableSlots([]);
          setAvailability("error");
        });
    }

    return () => controller.abort();
  }, [date, scheduleMode, preferredDay, endDate, time]);

  function handleDateChange(newDate: string) {
    setDate(newDate);
    setTime("");
    setAvailability("loading");
    setBookingFormError("");

    if (newDate && /^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      const day = getDayNameFromDateString(newDate);
      setPreferredDay(day);
    }
  }

  async function handleCreateBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBookingFormError("");
    setBookingSuccessMsg("");

    if (!date || (minimumDate && date < minimumDate)) {
      setBookingFormError("Start date cannot be in the past.");
      return;
    }

    if (!time) {
      setBookingFormError("Please choose an arrival time slot.");
      return;
    }

    if (!address.trim()) {
      setBookingFormError("Please enter your cleaning address.");
      return;
    }

    setIsSubmitting(true);

    try {
      if (scheduleMode === "one-time") {
        const response = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || customerName || customerEmail.split("@")[0],
            email: customerEmail,
            address: address.trim(),
            serviceId,
            date,
            time,
          }),
        });

        const result = (await response.json().catch(() => null)) as {
          booking?: { id: string };
          error?: string;
        } | null;

        if (!response.ok || !result?.booking) {
          throw new Error(result?.error ?? "Could not schedule cleaning.");
        }

        setBookingSuccessMsg(
          "Your cleaning has been booked successfully! A cleaner will accept and confirm your request shortly.",
        );
      } else {
        const response = await fetch("/api/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || customerName || customerEmail.split("@")[0],
            email: customerEmail,
            address: address.trim(),
            serviceId,
            frequency: scheduleMode,
            preferredDay,
            startDate: date,
            endDate: endDate || null,
            time,
          }),
        });

        const result = (await response.json().catch(() => null)) as {
          subscription?: { id: string };
          error?: string;
        } | null;

        if (!response.ok || !result?.subscription) {
          throw new Error(result?.error ?? "Could not schedule recurring cleaning.");
        }

        setBookingSuccessMsg(
          "Your recurring cleaning subscription has been set up successfully!",
        );
      }

      setRefresh((v) => v + 1);
      setActiveTab("upcoming");
    } catch (err) {
      setBookingFormError(
        err instanceof Error ? err.message : "Error creating booking.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    router.replace("/login");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link className="brand" href="/bookings" aria-label="Sai Ping home">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <span>Sai Ping</span>
          </Link>
          <span className="role-pill role-pill-customer">CUSTOMER PORTAL</span>
        </div>
        <div className="topbar-nav" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span className="topbar-user-email">
            {customerName || customerEmail}
          </span>
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
          <p className="eyebrow">CUSTOMER PORTAL</p>
          <h1>My Cleaning Services</h1>
          <p>
            {authStatus === "authenticated" && customerEmail
              ? `Signed in as ${customerName ? `${customerName} (${customerEmail})` : customerEmail}. Track your booking status and schedule home cleanings.`
              : "Keep track of your scheduled services and booking history."}
          </p>
        </div>

        {bookingSuccessMsg ? (
          <div className="success-banner" role="status" style={{ margin: "20px 0" }}>
            {bookingSuccessMsg}
          </div>
        ) : null}

        {authStatus === "loading" ? (
          <div className="dashboard-loading" role="status">
            <span className="dashboard-spinner" aria-hidden="true" />
            <p>Loading your cleaning portal…</p>
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
                className={`dashboard-tab${activeTab === "all" ? " is-active" : ""}`}
                onClick={() => setActiveTab("all")}
              >
                <span>All Bookings</span>
                <span className="tab-badge">{allBookings.length}</span>
              </button>

              <button
                type="button"
                role="tab"
                id="tab-book-new"
                aria-selected={activeTab === "book-new"}
                className={`dashboard-tab${activeTab === "book-new" ? " is-active" : ""}`}
                onClick={() => setActiveTab("book-new")}
                style={{ marginLeft: "auto", background: activeTab === "book-new" ? "var(--accent)" : "#f0f4ef", color: activeTab === "book-new" ? "#fff" : "var(--foreground)" }}
              >
                <span>+ Book a Cleaning</span>
              </button>
            </nav>

            {/* Tab Panel: Upcoming */}
            {activeTab === "upcoming" ? (
              <section id="panel-upcoming" role="tabpanel" className="tab-panel">
                {upcomingBookings.length === 0 ? (
                  <EmptyBookingsView
                    title="No upcoming cleanings scheduled"
                    description="You don't have any upcoming services scheduled at this time. Book a cleaning to get started!"
                    actionLabel="Book a new cleaning"
                    onAction={() => setActiveTab("book-new")}
                  />
                ) : (
                  <div className="booking-card-list">
                    {upcomingBookings.map((booking) => (
                      <BookingCard key={booking.id} booking={booking} onRated={() => setRefresh((v) => v + 1)} />
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {/* Tab Panel: Previous */}
            {activeTab === "previous" ? (
              <section id="panel-previous" role="tabpanel" className="tab-panel">
                {previousBookings.length === 0 ? (
                  <EmptyBookingsView
                    title="No previous cleanings found"
                    description="Your completed and past service records will appear here after cleanings are finished."
                    actionLabel="Schedule a cleaning"
                    onAction={() => setActiveTab("book-new")}
                  />
                ) : (
                  <div className="booking-card-list">
                    {previousBookings.map((booking) => (
                      <BookingCard key={booking.id} booking={booking} onRated={() => setRefresh((v) => v + 1)} />
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {/* Tab Panel: All */}
            {activeTab === "all" ? (
              <section id="panel-all" role="tabpanel" className="tab-panel">
                {allBookings.length === 0 ? (
                  <EmptyBookingsView
                    title="No bookings on file"
                    description="No service appointments are associated with this account."
                    actionLabel="Book a cleaning"
                    onAction={() => setActiveTab("book-new")}
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
                            <BookingCard key={b.id} booking={b} onRated={() => setRefresh((v) => v + 1)} />
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
                            <BookingCard key={b.id} booking={b} onRated={() => setRefresh((v) => v + 1)} />
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

            {/* Tab Panel: Book a New Cleaning */}
            {activeTab === "book-new" ? (
              <section id="panel-book-new" role="tabpanel" className="tab-panel">
                <div style={{ maxWidth: "760px", margin: "0 auto" }}>
                  <form onSubmit={handleCreateBooking} className="booking-form">
                    {bookingFormError ? (
                      <div className="form-error" role="alert" style={{ marginBottom: "20px" }}>
                        {bookingFormError}
                      </div>
                    ) : null}

                    {/* Step 1: Service Selection */}
                    <fieldset className="form-group" style={{ border: "none", padding: 0, margin: "0 0 24px" }}>
                      <legend className="field-label" style={{ fontWeight: 600, fontSize: "16px", marginBottom: "12px" }}>
                        1. Select Cleaning Service
                      </legend>
                      <div className="service-options-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
                        {SERVICES.map((s) => (
                          <label
                            key={s.id}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              padding: "16px",
                              borderRadius: "8px",
                              border: serviceId === s.id ? "2px solid var(--accent)" : "1px solid #dcdfdc",
                              background: serviceId === s.id ? "#f9fcf8" : "#fff",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="radio"
                              name="serviceId"
                              value={s.id}
                              checked={serviceId === s.id}
                              onChange={() => setServiceId(s.id)}
                              style={{ display: "none" }}
                            />
                            <strong style={{ fontSize: "15px", marginBottom: "4px" }}>{s.name}</strong>
                            <span style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "8px" }}>{s.description}</span>
                            <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--green)" }}>{displayPrice(s.priceCents)}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {/* Step 2: Cadence */}
                    <fieldset className="form-group" style={{ border: "none", padding: 0, margin: "0 0 24px" }}>
                      <legend className="field-label" style={{ fontWeight: 600, fontSize: "16px", marginBottom: "12px" }}>
                        2. Frequency
                      </legend>
                      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                        {[
                          { id: "one-time", label: "One-Time" },
                          { id: "weekly", label: "Weekly (Recurring)" },
                          { id: "biweekly", label: "Every 2 Weeks (Biweekly)" },
                        ].map((m) => (
                          <label
                            key={m.id}
                            style={{
                              padding: "10px 16px",
                              borderRadius: "6px",
                              border: scheduleMode === m.id ? "2px solid var(--accent)" : "1px solid #dcdfdc",
                              background: scheduleMode === m.id ? "#f9fcf8" : "#fff",
                              cursor: "pointer",
                              fontSize: "14px",
                              fontWeight: 500,
                            }}
                          >
                            <input
                              type="radio"
                              name="scheduleMode"
                              value={m.id}
                              checked={scheduleMode === m.id}
                              onChange={() => setScheduleMode(m.id as ScheduleMode)}
                              style={{ display: "none" }}
                            />
                            {m.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {/* Step 3: Pick an available day */}
                    <fieldset className="form-group" style={{ border: "none", padding: 0, margin: "0 0 24px" }}>
                      <legend className="field-label" style={{ fontWeight: 600, fontSize: "16px", marginBottom: "4px" }}>
                        {scheduleMode === "one-time" ? "3. Choose an Available Day" : "3. Choose Your First Cleaning Day"}
                      </legend>
                      <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: "13px" }}>
                        {scheduleMode === "one-time"
                          ? "Greyed-out days have no cleaner working or are fully booked."
                          : `Your ${scheduleMode === "weekly" ? "weekly" : "every-two-weeks"} cleaning will repeat on ${preferredDay}s.`}
                      </p>
                      {days.length === 0 ? (
                        <p style={{ color: "var(--muted)", fontSize: "13px" }}>Loading available days…</p>
                      ) : days.every((d) => d.availableSlots.length === 0) ? (
                        <p className="form-error" role="status" style={{ margin: 0 }}>
                          No cleaners are available yet — please check back soon once our cleaners have set their working days.
                        </p>
                      ) : (
                        <div className="date-picker">
                          {days.map((d) => {
                            const open = d.availableSlots.length;
                            const [, month, dayOfMonth] = d.date.split("-").map(Number);
                            return (
                              <button
                                key={d.date}
                                type="button"
                                className="date-option"
                                aria-pressed={date === d.date}
                                aria-label={`${displayDate(d.date)}: ${open ? `${open} arrival window${open === 1 ? "" : "s"} open` : "unavailable"}`}
                                disabled={open === 0}
                                onClick={() => handleDateChange(d.date)}
                              >
                                <span className="day-name">{d.dayName.slice(0, 3)}</span>
                                <span className="day-number">{dayOfMonth}</span>
                                <span className="day-name" style={{ fontWeight: 500 }}>
                                  {new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(2000, month - 1, 1))}
                                </span>
                                <span className="day-slots">{open ? `${open} open` : "Unavailable"}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </fieldset>

                    {/* Step 4: Time Slot */}
                    <fieldset className="form-group" style={{ border: "none", padding: 0, margin: "0 0 24px" }}>
                      <legend className="field-label" style={{ fontWeight: 600, fontSize: "16px", marginBottom: "12px" }}>
                        4. Arrival Window
                      </legend>
                      {availability === "loading" ? (
                        <p style={{ color: "var(--muted)", fontSize: "13px" }}>Checking cleaner arrival slot availability…</p>
                      ) : availableSlots.length === 0 ? (
                        <p style={{ color: "#c92a2a", fontSize: "13px" }}>
                          {scheduleMode === "one-time"
                            ? "No cleaners available on this date. Please choose another day."
                            : `One of your repeating ${preferredDay} dates is unavailable. Try another first day or time.`}
                        </p>
                      ) : (
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          {availableSlots.map((slot) => (
                            <label
                              key={slot}
                              style={{
                                padding: "10px 18px",
                                borderRadius: "6px",
                                border: time === slot ? "2px solid var(--accent)" : "1px solid #dcdfdc",
                                background: time === slot ? "#f9fcf8" : "#fff",
                                cursor: "pointer",
                                fontSize: "14px",
                                fontWeight: 500,
                              }}
                            >
                              <input
                                type="radio"
                                name="timeSlot"
                                value={slot}
                                checked={time === slot}
                                onChange={() => setTime(slot as BookingTime)}
                                style={{ display: "none" }}
                              />
                              {displayTime(slot)}
                            </label>
                          ))}
                        </div>
                      )}
                    </fieldset>

                    {/* Step 5: Address */}
                    <div style={{ marginBottom: "24px" }}>
                      <label className="field-label" htmlFor="booking-address" style={{ fontWeight: 600, marginBottom: "8px", display: "block" }}>
                        5. Cleaning Location / Address
                      </label>
                      <input
                        id="booking-address"
                        type="text"
                        className="field-input"
                        placeholder="e.g. 123 Maple Street, Apt 4B"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        required
                        style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }}
                      />
                    </div>

                    {/* Summary & Submit */}
                    <div style={{ padding: "16px", background: "#f8faf8", borderRadius: "8px", marginBottom: "20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <strong style={{ fontSize: "16px" }}>{selectedService.name}</strong>
                          <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
                            {scheduleMode.toUpperCase()} • {date ? displayDate(date) : "Select date"} at {time ? displayTime(time) : "Select time"}
                          </div>
                        </div>
                        <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--green)" }}>
                          {displayPrice(selectedService.priceCents)}
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="confirm-button"
                      disabled={isSubmitting || !time || !date || !address.trim()}
                      style={{ width: "100%", padding: "14px", fontSize: "16px", fontWeight: 600 }}
                    >
                      {isSubmitting ? "Submitting Booking…" : "Confirm Booking Request"}
                    </button>
                  </form>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function BookingCard({
  booking,
  onRated,
}: {
  booking: CustomerBooking;
  onRated: () => void;
}) {
  const isCompleted = booking.status === "completed";
  const isAccepted = Boolean(booking.acceptedByName || booking.isAccepted);
  const [isRating, setIsRating] = useState(false);

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
          {isCompleted ? (
            <span className="status-badge status-badge-completed">
              <span className="status-indicator-dot" aria-hidden="true" />
              Completed
            </span>
          ) : isAccepted ? (
            <span className="status-badge status-badge-scheduled">
              <span className="status-indicator-dot" aria-hidden="true" />
              Confirmed & Accepted
            </span>
          ) : (
            <span className="status-badge status-badge-pending">
              <span className="status-indicator-dot" aria-hidden="true" />
              Requested (Awaiting Cleaner)
            </span>
          )}
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
          <span className="detail-label">Cleaner Assigned</span>
          <strong className="detail-value">
            {booking.acceptedByName ? (
              <span style={{ color: "var(--green)" }}>{booking.acceptedByName} ✓</span>
            ) : isCompleted ? (
              booking.cleanerName
            ) : (
              <span style={{ color: "#b46b0a" }}>Searching for cleaner…</span>
            )}
          </strong>
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
            ) : isRating ? null : (
              <button
                type="button"
                className="action-button-link"
                onClick={() => setIsRating(true)}
              >
                Rate & review your cleaner ★
              </button>
            )
          ) : isAccepted ? (
            <span className="upcoming-hint" style={{ color: "var(--green)" }}>
              Cleaner confirmed & scheduled
            </span>
          ) : (
            <span className="upcoming-hint" style={{ color: "#b46b0a" }}>
              Request placed — awaiting cleaner acceptance
            </span>
          )}
        </div>
      </div>

      {isCompleted && booking.rating !== null && booking.review ? (
        <p className="submitted-review">Your review: “{booking.review}”</p>
      ) : null}

      {isCompleted && booking.rating === null && isRating ? (
        <InlineRatingForm
          booking={booking}
          onCancel={() => setIsRating(false)}
          onSaved={onRated}
        />
      ) : null}
    </article>
  );
}

function InlineRatingForm({
  booking,
  onCancel,
  onSaved,
}: {
  booking: CustomerBooking;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const cleaner = booking.acceptedByName || booking.cleanerName;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stars) {
      setError("Choose a star rating from 1 to 5.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(booking.id)}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars, review: review.trim() || null }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Your rating could not be saved.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your rating could not be saved.");
      setIsSaving(false);
    }
  }

  return (
    <form className="inline-rating" onSubmit={submit}>
      <strong>How did {cleaner} do?</strong>
      <div className="rating-stars" role="group" aria-label="Choose a rating from 1 to 5 stars">
        {Array.from({ length: 5 }, (_, index) => {
          const value = index + 1;
          return (
            <button
              key={value}
              type="button"
              className={value <= stars ? "is-filled" : ""}
              aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
              aria-pressed={stars === value}
              onClick={() => setStars(value)}
            >
              ★
            </button>
          );
        })}
      </div>
      <label className="field-label" htmlFor={`review-${booking.id}`}>
        Write a review (optional)
      </label>
      <textarea
        id={`review-${booking.id}`}
        className="review-textarea"
        maxLength={1000}
        placeholder="What went well? Anything the cleaner could improve?"
        value={review}
        onChange={(e) => setReview(e.target.value)}
      />
      {error ? (
        <p className="form-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <button
          type="submit"
          className="confirm-button"
          style={{ width: "auto", padding: "10px 22px", margin: 0 }}
          disabled={isSaving || !stars}
        >
          {isSaving ? "Saving…" : "Submit rating & review"}
        </button>
        <button type="button" className="inline-button" onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EmptyBookingsView({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="empty-bookings-card" role="region" aria-label={title}>
      <div className="empty-icon-circle" aria-hidden="true">
        📅
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <button
        type="button"
        className="confirm-button empty-action-btn"
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  );
}
