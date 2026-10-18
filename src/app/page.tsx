"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  SERVICES,
  TIME_SLOTS,
  type BookingTime,
  type ServiceId,
} from "@/lib/services";

type Confirmation = {
  id: string;
  serviceName: string;
  priceCents: number;
  date: string;
  time: BookingTime;
  address: string;
  email: string;
};

function dateString(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function displayDate(value: string) {
  if (!value) return "Choose a date";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
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

export default function Home() {
  const [serviceId, setServiceId] = useState<ServiceId>("essential");
  const [minimumDate, setMinimumDate] = useState("");
  const [date, setDate] = useState("");
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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const selectedService =
    SERVICES.find((service) => service.id === serviceId) ?? SERVICES[0];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const today = new Date();
      setMinimumDate(dateString(today));
      today.setDate(today.getDate() + 1);
      setDate(dateString(today));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
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
          throw new Error(result.error ?? "Availability could not be checked.");
        setAvailableSlots(result.availableSlots ?? []);
        setAvailability("ready");
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setAvailableSlots([]);
        setAvailability("error");
      });
    return () => controller.abort();
  }, [date, refresh]);

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
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
          result?.error ?? "Your booking could not be saved. Please try again.",
        );
      }
      setConfirmation(result.booking);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your booking could not be saved.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

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
            Your appointment is reserved. Keep this reference for your records.
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
          <Link className="text-link" href="/">
            Book another cleaning
          </Link>
        </section>
      </main>
    );
  }

  const canSubmit =
    Boolean(name.trim() && email.trim() && address.trim() && time) &&
    availability === "ready" &&
    availableSlots.includes(time);

  return (
    <main className="app-shell">
      <Header />
      <div className="booking-container">
        <div className="page-heading">
          <p className="eyebrow">HOME CLEANING, MADE SIMPLE</p>
          <h1>Book a cleaning</h1>
          <p>Choose your service and a time that works for you.</p>
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
                title="Set the appointment"
                id="appointment-heading"
              />
              <label className="field-label" htmlFor="service-date">
                Cleaning date
              </label>
              <input
                className="text-input date-input"
                id="service-date"
                type="date"
                min={minimumDate}
                value={date}
                required
                onChange={(event) => {
                  setDate(event.target.value);
                  setTime("");
                  setAvailability("loading");
                  setError("");
                }}
              />
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
                    availability === "ready" && availableSlots.includes(slot);
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
                            : available
                              ? "Available"
                              : "Booked"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {availability === "error" ? (
                <div className="availability-message" role="status">
                  <span>Could not check times for this date.</span>
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
              ) : availability === "ready" && availableSlots.length === 0 ? (
                <p className="availability-message" role="status">
                  No appointments are open for this date. Try another day.
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
              <p className="eyebrow">YOUR APPOINTMENT</p>
              <span className="summary-status">
                <span /> Live price
              </span>
            </div>
            <h2 id="summary-heading">Booking summary</h2>
            <p className="summary-service">{selectedService.name}</p>
            <div className="summary-price">
              {displayPrice(selectedService.priceCents)}
            </div>
            <p className="price-caption">Flat price for this service</p>
            <div className="summary-rule" />
            <dl className="summary-details">
              <SummaryRow label="Date" value={displayDate(date)} />
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
              {isSubmitting ? "Reserving your time..." : "Confirm booking"}
            </button>
            <p className="summary-footnote">
              Your time is checked again when you confirm.
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
