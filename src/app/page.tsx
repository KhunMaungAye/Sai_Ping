"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  SERVICES,
  TIME_SLOTS,
  type BookingTime,
  type ServiceId,
} from "@/lib/services";
import {
  DAYS_OF_WEEK,
  addDaysToDateString,
  generateRecurringDates,
  getDayNameFromDateString,
  getNextServiceDate,
  type Frequency,
} from "@/lib/date-utils";

type Confirmation = {
  id: string;
  serviceName: string;
  priceCents: number;
  date: string;
  time: BookingTime;
  address: string;
  email: string;
};

type SubscriptionConfirmation = {
  id: string;
  serviceName: string;
  priceCents: number;
  frequency: Frequency;
  preferredDay: string;
  startDate: string;
  endDate: string | null;
  nextServiceDate: string;
  time: BookingTime;
  address: string;
  email: string;
  bookings: { id: string; date: string; time: BookingTime }[];
};

type ScheduleMode = "one-time" | "weekly" | "biweekly";

function dateString(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function displayDate(value: string) {
  if (!value) return "Choose a date";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function displayShortDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function displayTime(value: string) {
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

const ORDERED_DAYS: string[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export default function Home() {
  const [serviceId, setServiceId] = useState<ServiceId>("essential");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("one-time");
  const [minimumDate, setMinimumDate] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [preferredDay, setPreferredDay] = useState("Monday");
  const [time, setTime] = useState<BookingTime | "">("");
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [availability, setAvailability] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [refresh, setRefresh] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [conflictDate, setConflictDate] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [subscriptionConfirmation, setSubscriptionConfirmation] =
    useState<SubscriptionConfirmation | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const selectedService =
    SERVICES.find((service) => service.id === serviceId) ?? SERVICES[0];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const today = new Date();
      const minStr = dateString(today);
      setMinimumDate(minStr);
      today.setDate(today.getDate() + 1);
      const tomorrowStr = dateString(today);
      setDate(tomorrowStr);
      setPreferredDay(getDayNameFromDateString(tomorrowStr));
      if (typeof window !== "undefined" && window.crypto?.randomUUID) {
        setIdempotencyKey(window.crypto.randomUUID());
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const nextServiceDate =
    scheduleMode === "one-time"
      ? date
      : getNextServiceDate(date, preferredDay);

  const previewDates =
    scheduleMode !== "one-time" && date
      ? generateRecurringDates({
          startDate: date,
          frequency: scheduleMode as Frequency,
          preferredDay,
          endDate: endDate || null,
          occurrences: 4,
        })
      : [];

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
            throw new Error(
              result.error ?? "Availability could not be checked.",
            );
          setAvailableSlots(result.availableSlots ?? []);
          setAvailability("ready");
          setConflictDate(null);
        })
        .catch((reason: unknown) => {
          if (reason instanceof Error && reason.name === "AbortError") return;
          setAvailableSlots([]);
          setAvailability("error");
        });
    } else {
      // Recurring schedule: check availability of preferred arrival slots
      const checkDate = nextServiceDate || date;
      const checkFrequency = scheduleMode;
      const checkEnd = endDate ? `&endDate=${encodeURIComponent(endDate)}` : "";

      const checkTime = time || "09:00";
      fetch(
        `/api/subscriptions?startDate=${encodeURIComponent(checkDate)}&frequency=${checkFrequency}&time=${checkTime}&preferredDay=${encodeURIComponent(preferredDay)}${checkEnd}`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      )
        .then(async (response) => {
          const result = (await response.json()) as {
            available?: boolean;
            conflictDate?: string | null;
            error?: string;
          };
          if (!response.ok) {
            setAvailableSlots([]);
            setAvailability("error");
            return;
          }
          if (result.available) {
            setAvailableSlots([...TIME_SLOTS]);
            setConflictDate(null);
          } else {
            setConflictDate(result.conflictDate ?? null);
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
  }, [date, scheduleMode, preferredDay, endDate, time, refresh, nextServiceDate]);

  function handlePreferredDaySelect(dayName: string) {
    setPreferredDay(dayName);
    setError("");
    setConflictDate(null);

    // Compute the next upcoming date for this day of the week
    const targetDayIndex = DAYS_OF_WEEK.indexOf(
      dayName as (typeof DAYS_OF_WEEK)[number],
    );
    if (targetDayIndex >= 0 && minimumDate) {
      const [y, m, d] = minimumDate.split("-").map(Number);
      const minDayIndex = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const diff = (targetDayIndex - minDayIndex + 7) % 7;
      const computedDate = addDaysToDateString(minimumDate, diff);
      setDate(computedDate);
    }
  }

  function handleDateChange(newDate: string) {
    setDate(newDate);
    setTime("");
    setAvailability("loading");
    setError("");
    setConflictDate(null);

    if (newDate && /^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      const day = getDayNameFromDateString(newDate);
      setPreferredDay(day);
    }
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setConflictDate(null);

    // Client-side validations
    if (!date || (minimumDate && date < minimumDate)) {
      setError("Start date cannot be in the past.");
      return;
    }

    if (scheduleMode !== "one-time" && endDate && endDate < date) {
      setError("End date cannot be earlier than start date.");
      return;
    }

    if (!time) {
      setError("Please choose an arrival time.");
      return;
    }

    setIsSubmitting(true);

    try {
      if (scheduleMode === "one-time") {
        const response = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, address, serviceId, date, time }),
        });
        const result = (await response.json().catch(() => null)) as {
          booking?: Confirmation;
          error?: string;
          code?: string;
        } | null;

        if (response.status === 409 && result?.code === "SLOT_UNAVAILABLE") {
          setTime("");
          setAvailability("loading");
          setRefresh((value) => value + 1);
          setError(
            result.error ??
              "That appointment was just booked. Choose another time.",
          );
          return;
        }

        if (!response.ok || !result?.booking) {
          throw new Error(
            result?.error ??
              "Your booking could not be saved. Please try again.",
          );
        }

        setConfirmation(result.booking);
      } else {
        // Recurring subscription setup
        const response = await fetch("/api/subscriptions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({
            name,
            email,
            address,
            serviceId,
            frequency: scheduleMode,
            preferredDay,
            startDate: date,
            endDate: endDate || null,
            time,
            idempotencyKey,
          }),
        });

        const result = (await response.json().catch(() => null)) as {
          subscription?: SubscriptionConfirmation;
          bookings?: { id: string; date: string; time: BookingTime }[];
          error?: string;
          code?: string;
          conflictDate?: string;
        } | null;

        if (
          response.status === 409 &&
          result?.code === "RECURRING_SLOT_UNAVAILABLE"
        ) {
          setConflictDate(result.conflictDate ?? null);
          setError(
            result.error ??
              `Cleaner is unavailable on ${result.conflictDate || "a recurring date"}. No bookings were created.`,
          );
          return;
        }

        if (!response.ok || !result?.subscription) {
          throw new Error(
            result?.error ??
              "Your subscription could not be saved. Please try again.",
          );
        }

        setSubscriptionConfirmation({
          ...result.subscription,
          bookings: result.bookings ?? [],
        });
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your request could not be processed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // Confirmation view for Recurring Subscription
  if (subscriptionConfirmation) {
    return (
      <main className="app-shell">
        <Header />
        <section
          className="confirmation-page"
          aria-labelledby="subscription-confirmation-title"
        >
          <p className="eyebrow">SUBSCRIPTION RESERVED</p>
          <h1 id="subscription-confirmation-title">
            Your recurring cleaning is set up.
          </h1>
          <p className="confirmation-copy">
            We will arrive on your preferred day according to your schedule.
            Return to your rating page after each service is completed.
          </p>
          <div className="confirmation-panel">
            <div className="confirmation-id">
              <span>SUBSCRIPTION REFERENCE</span>
              <strong>
                {subscriptionConfirmation.id.slice(0, 8).toUpperCase()}
              </strong>
            </div>
            <dl className="summary-details">
              <SummaryRow
                label="Service"
                value={subscriptionConfirmation.serviceName}
              />
              <SummaryRow
                label="Frequency"
                value={
                  subscriptionConfirmation.frequency === "weekly"
                    ? "Weekly (Every week)"
                    : "Biweekly (Every 2 weeks)"
                }
              />
              <SummaryRow
                label="Preferred day"
                value={`Every ${subscriptionConfirmation.preferredDay}`}
              />
              <SummaryRow
                label="Next service"
                value={`${displayDate(subscriptionConfirmation.nextServiceDate)} at ${displayTime(subscriptionConfirmation.time)}`}
              />
              {subscriptionConfirmation.endDate ? (
                <SummaryRow
                  label="End date"
                  value={displayDate(subscriptionConfirmation.endDate)}
                />
              ) : null}
              <SummaryRow
                label="Address"
                value={subscriptionConfirmation.address}
              />
              <SummaryRow
                label="Email"
                value={subscriptionConfirmation.email}
              />
            </dl>
            <div className="confirmation-total">
              <span>Price per visit</span>
              <strong>
                {displayPrice(subscriptionConfirmation.priceCents)}
              </strong>
            </div>

            {subscriptionConfirmation.bookings.length > 0 ? (
              <div style={{ marginTop: "20px" }}>
                <span className="field-label">Scheduled cleanings</span>
                <ul className="scheduled-bookings-list">
                  {subscriptionConfirmation.bookings.map((booking, idx) => (
                    <li key={booking.id} className="scheduled-booking-item">
                      <strong>
                        Visit {idx + 1}: {displayShortDate(booking.date)}
                      </strong>
                      <span>{displayTime(booking.time)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {subscriptionConfirmation.bookings[0] ? (
            <Link
              className="text-link"
              href={`/rate/${encodeURIComponent(subscriptionConfirmation.bookings[0].id)}`}
            >
              View first booking and rate cleaner
            </Link>
          ) : null}
          <Link
            className="text-link"
            href="/"
            onClick={() => {
              setConfirmation(null);
              setSubscriptionConfirmation(null);
            }}
          >
            Book another cleaning
          </Link>
        </section>
      </main>
    );
  }

  // Confirmation view for One-Time Booking
  if (confirmation) {
    return (
      <main className="app-shell">
        <Header />
        <section
          className="confirmation-page"
          aria-labelledby="confirmation-title"
        >
          <p className="eyebrow">BOOKING RESERVED</p>
          <h1 id="confirmation-title">You can cross cleaning off your list.</h1>
          <p className="confirmation-copy">
            Your appointment is reserved. Return to your rating page after the
            service is completed.
          </p>
          <div className="confirmation-panel">
            <div className="confirmation-id">
              <span>REFERENCE</span>
              <strong>{confirmation.id.slice(0, 8).toUpperCase()}</strong>
            </div>
            <dl className="summary-details">
              <SummaryRow label="Service" value={confirmation.serviceName} />
              <SummaryRow label="Date" value={displayDate(confirmation.date)} />
              <SummaryRow
                label="Arrival"
                value={displayTime(confirmation.time)}
              />
              <SummaryRow label="Address" value={confirmation.address} />
              <SummaryRow label="Email" value={confirmation.email} />
            </dl>
            <div className="confirmation-total">
              <span>Service price</span>
              <strong>{displayPrice(confirmation.priceCents)}</strong>
            </div>
          </div>
          <Link
            className="text-link"
            href={`/rate/${encodeURIComponent(confirmation.id)}`}
          >
            View booking and rate your cleaner
          </Link>
          <Link
            className="text-link"
            href="/"
            onClick={() => {
              setConfirmation(null);
              setSubscriptionConfirmation(null);
            }}
          >
            Book another cleaning
          </Link>
        </section>
      </main>
    );
  }

  const isEndDateInvalid =
    scheduleMode !== "one-time" && Boolean(endDate && endDate < date);
  const isStartDateInvalid = Boolean(
    date && minimumDate && date < minimumDate,
  );

  const canSubmit =
    Boolean(name.trim() && email.trim() && address.trim() && time) &&
    !isStartDateInvalid &&
    !isEndDateInvalid &&
    !conflictDate &&
    availability === "ready";

  return (
    <main className="app-shell">
      <Header />
      <div className="booking-container">
        <div className="page-heading">
          <p className="eyebrow">HOME CLEANING, MADE SIMPLE</p>
          <h1>Book a cleaning</h1>
          <p>Choose your service and a schedule that fits your life.</p>
        </div>
        <div className="booking-layout">
          <form
            id="booking-form"
            className="booking-form"
            onSubmit={submitBooking}
          >
            <section className="form-section" aria-labelledby="service-heading">
              <SectionHeading
                number="01"
                title="Choose your clean"
                id="service-heading"
              />
              <div
                className="service-list"
                role="group"
                aria-label="Cleaning service"
              >
                {SERVICES.map((service, index) => {
                  const selected = service.id === serviceId;
                  return (
                    <button
                      className={`service-option${selected ? " is-selected" : ""}`}
                      type="button"
                      key={service.id}
                      aria-pressed={selected}
                      onClick={() => setServiceId(service.id)}
                    >
                      <span className="service-index">0{index + 1}</span>
                      <span className="service-copy">
                        <span className="service-name">{service.name}</span>
                        <span className="service-description">
                          {service.description}
                        </span>
                        <span className="service-duration">
                          About {service.duration}
                        </span>
                      </span>
                      <span className="service-price">
                        {displayPrice(service.priceCents)}
                      </span>
                      <span className="choice-indicator" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </section>

            <section
              className="form-section"
              aria-labelledby="appointment-heading"
            >
              <SectionHeading
                number="02"
                title="Set the schedule & appointment"
                id="appointment-heading"
              />

              <label className="field-label">Subscription & Frequency</label>
              <div
                className="frequency-options"
                role="group"
                aria-label="Cleaning Frequency"
              >
                <button
                  type="button"
                  className={`frequency-option${scheduleMode === "one-time" ? " is-selected" : ""}`}
                  aria-pressed={scheduleMode === "one-time"}
                  onClick={() => {
                    setScheduleMode("one-time");
                    setError("");
                    setConflictDate(null);
                  }}
                >
                  <span className="frequency-title">One-time clean</span>
                  <span className="frequency-subtitle">Single service</span>
                </button>
                <button
                  type="button"
                  className={`frequency-option${scheduleMode === "weekly" ? " is-selected" : ""}`}
                  aria-pressed={scheduleMode === "weekly"}
                  onClick={() => {
                    setScheduleMode("weekly");
                    setError("");
                    setConflictDate(null);
                  }}
                >
                  <span className="frequency-title">Weekly clean</span>
                  <span className="frequency-subtitle">Every 7 days</span>
                </button>
                <button
                  type="button"
                  className={`frequency-option${scheduleMode === "biweekly" ? " is-selected" : ""}`}
                  aria-pressed={scheduleMode === "biweekly"}
                  onClick={() => {
                    setScheduleMode("biweekly");
                    setError("");
                    setConflictDate(null);
                  }}
                >
                  <span className="frequency-title">Biweekly clean</span>
                  <span className="frequency-subtitle">Every 2 weeks</span>
                </button>
              </div>

              {scheduleMode !== "one-time" ? (
                <>
                  <label className="field-label">Preferred service day</label>
                  <div
                    className="day-options"
                    role="group"
                    aria-label="Preferred day of the week"
                  >
                    {ORDERED_DAYS.map((day) => {
                      const isSelected = preferredDay === day;
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`day-option${isSelected ? " is-selected" : ""}`}
                          aria-pressed={isSelected}
                          onClick={() => handlePreferredDaySelect(day)}
                        >
                          {day.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>

                  <div className="next-service-callout" role="region" aria-label="Next scheduled service date">
                    <div className="next-service-header">
                      <span className="next-service-eyebrow">
                        NEXT SCHEDULED SERVICE DATE
                      </span>
                      <span className="slot-timezone">
                        {scheduleMode === "weekly" ? "Weekly" : "Biweekly"} on {preferredDay}s
                      </span>
                    </div>
                    <div className="next-service-date">
                      {nextServiceDate ? displayDate(nextServiceDate) : "Select a start date"}
                    </div>
                    {previewDates.length > 0 ? (
                      <div className="upcoming-dates-list">
                        <span>Upcoming visits:</span>
                        {previewDates.map((d) => (
                          <span key={d} className="upcoming-date-pill">
                            {displayShortDate(d)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              <div className="date-range-fields">
                <div>
                  <label className="field-label" htmlFor="service-date">
                    {scheduleMode === "one-time" ? "Cleaning date" : "Start date"}
                  </label>
                  <input
                    className="text-input date-input"
                    id="service-date"
                    type="date"
                    min={minimumDate}
                    value={date}
                    required
                    onChange={(event) => handleDateChange(event.target.value)}
                  />
                  {isStartDateInvalid ? (
                    <span className="field-hint" style={{ color: "var(--coral)" }}>
                      Start date cannot be in the past.
                    </span>
                  ) : null}
                </div>

                {scheduleMode !== "one-time" ? (
                  <div>
                    <label className="field-label" htmlFor="end-date">
                      End date (optional)
                    </label>
                    <input
                      className="text-input date-input"
                      id="end-date"
                      type="date"
                      min={date || minimumDate}
                      value={endDate}
                      onChange={(event) => {
                        setEndDate(event.target.value);
                        setError("");
                      }}
                    />
                    {isEndDateInvalid ? (
                      <span className="field-hint" style={{ color: "var(--coral)" }}>
                        End date cannot be earlier than start date.
                      </span>
                    ) : (
                      <span className="field-hint">
                        Leave blank for standard initial visits.
                      </span>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="slot-heading">
                <span className="field-label">Arrival time</span>
                <span className="slot-timezone">Local time</span>
              </div>
              <div
                className="time-options"
                role="group"
                aria-label="Available arrival times"
              >
                {TIME_SLOTS.map((slot) => {
                  const available =
                    availability === "ready" &&
                    availableSlots.includes(slot) &&
                    !conflictDate;
                  return (
                    <button
                      className={`time-option${time === slot ? " is-selected" : ""}`}
                      type="button"
                      key={slot}
                      disabled={!available || isSubmitting}
                      aria-pressed={time === slot}
                      onClick={() => {
                        setTime(slot);
                        setError("");
                      }}
                    >
                      <span>{displayTime(slot)}</span>
                      <span className="slot-status">
                        {availability === "loading"
                          ? "Checking"
                          : availability === "error"
                            ? "Unavailable"
                            : conflictDate
                              ? "Conflict"
                              : available
                                ? "Available"
                                : "Booked"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {conflictDate ? (
                <div className="form-error" role="alert" style={{ marginTop: "14px" }}>
                  <strong>Cleaner Conflict:</strong> Unavailable on{" "}
                  {displayDate(conflictDate)} at {time ? displayTime(time) : "selected slot"}.
                  Please choose another day or time.
                </div>
              ) : null}

              {availability === "error" ? (
                <div className="availability-message" role="status">
                  <span>Could not check times for this schedule.</span>
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => {
                      setAvailability("loading");
                      setRefresh((value) => value + 1);
                    }}
                  >
                    Try again
                  </button>
                </div>
              ) : availability === "ready" &&
                availableSlots.length === 0 &&
                !conflictDate ? (
                <p className="availability-message" role="status">
                  No appointments are open for this schedule. Try another day or time.
                </p>
              ) : null}
            </section>

            <section
              className="form-section"
              aria-labelledby="location-heading"
            >
              <SectionHeading
                number="03"
                title="Where should we go?"
                id="location-heading"
              />
              <label className="field-label" htmlFor="service-address">
                Service address
              </label>
              <input
                className="text-input"
                id="service-address"
                name="address"
                autoComplete="street-address"
                placeholder="Street, city, ZIP code"
                maxLength={300}
                value={address}
                required
                onChange={(event) => setAddress(event.target.value)}
              />
              <div className="contact-fields">
                <div>
                  <label className="field-label" htmlFor="customer-name">
                    Your name
                  </label>
                  <input
                    className="text-input"
                    id="customer-name"
                    name="name"
                    autoComplete="name"
                    placeholder="Full name"
                    maxLength={100}
                    value={name}
                    required
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="customer-email">
                    Email
                  </label>
                  <input
                    className="text-input"
                    id="customer-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    maxLength={254}
                    value={email}
                    required
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              </div>
            </section>
          </form>

          <aside className="summary-panel" aria-labelledby="summary-heading">
            <div className="summary-topline">
              <p className="eyebrow">
                {scheduleMode === "one-time" ? "YOUR APPOINTMENT" : "YOUR SUBSCRIPTION"}
              </p>
              <span className="summary-status">
                <span /> Live price
              </span>
            </div>
            <h2 id="summary-heading">Booking summary</h2>
            <p className="summary-service">{selectedService.name}</p>
            <div className="summary-price">
              {displayPrice(selectedService.priceCents)}
            </div>
            <p className="price-caption">
              {scheduleMode === "one-time"
                ? "Flat price for this service"
                : "Flat price per service visit"}
            </p>
            <div className="summary-rule" />
            <dl className="summary-details">
              <SummaryRow
                label="Cadence"
                value={
                  scheduleMode === "one-time"
                    ? "One-time service"
                    : scheduleMode === "weekly"
                      ? "Weekly subscription"
                      : "Biweekly subscription"
                }
              />
              {scheduleMode !== "one-time" ? (
                <SummaryRow
                  label="Day"
                  value={`Every ${preferredDay}`}
                />
              ) : null}
              <SummaryRow
                label="Next service"
                value={displayDate(nextServiceDate)}
              />
              <SummaryRow
                label="Arrival"
                value={time ? displayTime(time) : "Choose a time"}
              />
              <SummaryRow
                label="Address"
                value={address || "Add your address"}
              />
              <SummaryRow label="Contact" value={email || "Add your email"} />
            </dl>

            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            <button
              className="confirm-button"
              type="submit"
              form="booking-form"
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting
                ? "Reserving..."
                : scheduleMode === "one-time"
                  ? "Confirm booking"
                  : `Confirm ${scheduleMode} subscription`}
            </button>
            <p className="summary-footnote">
              {scheduleMode === "one-time"
                ? "Your time is checked again when you confirm."
                : "All recurring dates are validated before confirming."}
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Header() {
  return (
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Sai Ping home">
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <span>Sai Ping</span>
      </Link>
      <span className="topbar-note">A little more room to breathe.</span>
      <span className="topbar-contact">Home appointments</span>
    </header>
  );
}

function SectionHeading({
  number,
  title,
  id,
}: {
  number: string;
  title: string;
  id: string;
}) {
  return (
    <div className="section-heading">
      <span className="section-number">{number}</span>
      <h2 id={id}>{title}</h2>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
