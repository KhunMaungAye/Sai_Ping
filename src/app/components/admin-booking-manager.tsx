"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AdminBooking, AdminBookingChange } from "@/lib/booking-store";
import { adminCleanerLabel } from "@/lib/admin-bookings";
import { SPECIAL_INSTRUCTIONS_MAX_LENGTH, TIME_SLOTS } from "@/lib/services";

const TIME_LABELS: Record<string, string> = { "09:00": "9:00 AM", "14:00": "2:00 PM" };

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function displayDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function displayPrice(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

type FormState = {
  address: string;
  specialInstructions: string;
  date: string;
  time: string;
  status: "scheduled" | "completed";
};

function toForm(booking: AdminBooking): FormState {
  return {
    address: booking.address,
    specialInstructions: booking.specialInstructions ?? "",
    date: booking.date,
    time: booking.time,
    status: booking.status,
  };
}

/**
 * US-08: pop-up where the admin views one booking in full and updates its
 * details (address, special instructions, date and arrival window) or its
 * service status. Only changed fields are sent; the server checks every rule.
 */
export function AdminBookingManager({
  bookingId,
  onClose,
  onSaved,
}: {
  bookingId: string;
  onClose: () => void;
  onSaved: (booking: AdminBooking, message: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [booking, setBooking] = useState<AdminBooking | null>(null);
  const [history, setHistory] = useState<AdminBookingChange[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Load the booking fresh, so the admin edits what is saved now.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.booking) throw new Error(data?.error ?? "Could not load this booking.");
        setBooking(data.booking);
        setHistory(data.changes ?? []);
        setForm(toForm(data.booking));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Could not load this booking.");
      });
    return () => controller.abort();
  }, [bookingId]);

  // Escape closes; focus stays inside the pop-up and returns afterwards.
  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.querySelector<HTMLElement>(".auth-modal-close")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        ) ?? [],
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setSaveError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking || !form || isSaving) return;

    const original = toForm(booking);
    const changes: Partial<FormState> = {};
    if (form.address.trim() !== original.address) changes.address = form.address;
    if (form.specialInstructions.trim() !== original.specialInstructions) {
      changes.specialInstructions = form.specialInstructions;
    }
    if (form.date !== original.date) changes.date = form.date;
    if (form.time !== original.time) changes.time = form.time;
    if (form.status !== original.status) changes.status = form.status;

    if (Object.keys(changes).length === 0) {
      setSaveError("Nothing has changed yet.");
      return;
    }
    if (changes.address !== undefined && form.address.trim().length < 5) {
      setSaveError("The address must be at least 5 characters.");
      return;
    }

    setIsSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`/api/admin/bookings/${encodeURIComponent(booking.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error ?? "The booking could not be updated.");
      }
      setBooking(data.booking);
      setHistory(data.changes ?? []);
      setForm(toForm(data.booking));
      onSaved(data.booking, data.message ?? "Booking updated.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The booking could not be updated.");
    } finally {
      setIsSaving(false);
    }
  }

  const isCompleted = booking?.status === "completed";
  const checkedIn = Boolean(booking?.arrivedAt);
  const lockDate = isCompleted || checkedIn || form?.status === "completed";
  const instructionsLength = form?.specialInstructions.length ?? 0;

  return (
    <div
      className="auth-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="auth-modal admin-booking-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-booking-title"
      >
        <button type="button" className="auth-modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>

        <h2 id="admin-booking-title" className="admin-booking-title">
          Manage booking{" "}
          <span className="ref-tag">{bookingId.slice(0, 8).toUpperCase()}</span>
        </h2>

        {loadError ? (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        ) : null}

        {!booking || !form ? (
          loadError ? null : (
            <p className="admin-booking-loading" role="status">
              Loading booking…
            </p>
          )
        ) : (
          <>
            <dl className="admin-booking-summary">
              <div>
                <dt>Customer</dt>
                <dd>
                  {booking.name}
                  <span>{booking.email}</span>
                </dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd>
                  {booking.serviceName}
                  <span>{displayPrice(booking.priceCents)}</span>
                </dd>
              </div>
              <div>
                <dt>Visit</dt>
                <dd>
                  {displayDate(booking.date)}
                  <span>{TIME_LABELS[booking.time] ?? booking.time}</span>
                </dd>
              </div>
              <div>
                <dt>Cleaner</dt>
                <dd>
                  {adminCleanerLabel(booking)}
                  {checkedIn ? <span>Checked in</span> : null}
                </dd>
              </div>
              <div>
                <dt>Booking type</dt>
                <dd>{booking.subscriptionId ? "Recurring plan visit" : "One-time"}</dd>
              </div>
              <div>
                <dt>Rating</dt>
                <dd>{booking.rating ? `${booking.rating} / 5` : "Not rated yet"}</dd>
              </div>
            </dl>

            <form className="admin-booking-form" onSubmit={handleSubmit} noValidate>
              <label className="admin-booking-field">
                <span>Cleaning address</span>
                <textarea
                  className="text-input"
                  value={form.address}
                  maxLength={300}
                  rows={2}
                  onChange={(event) => update("address", event.target.value)}
                />
              </label>

              <label className="admin-booking-field">
                <span>Special instructions</span>
                <textarea
                  className="text-input"
                  value={form.specialInstructions}
                  maxLength={SPECIAL_INSTRUCTIONS_MAX_LENGTH}
                  rows={3}
                  placeholder="No special instructions"
                  onChange={(event) => update("specialInstructions", event.target.value)}
                />
                <span
                  className={`char-counter${
                    instructionsLength >= SPECIAL_INSTRUCTIONS_MAX_LENGTH ? " is-at-limit" : ""
                  }`}
                >
                  {instructionsLength}/{SPECIAL_INSTRUCTIONS_MAX_LENGTH}
                </span>
              </label>

              <div className="admin-booking-row">
                <label className="admin-booking-field">
                  <span>Date</span>
                  <input
                    className="text-input"
                    type="date"
                    value={form.date}
                    disabled={lockDate}
                    onChange={(event) => update("date", event.target.value)}
                  />
                </label>
                <label className="admin-booking-field">
                  <span>Arrival window</span>
                  <select
                    className="text-input"
                    value={form.time}
                    disabled={lockDate}
                    onChange={(event) => update("time", event.target.value)}
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {TIME_LABELS[slot] ?? slot}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {lockDate ? (
                <span className="field-hint">
                  {checkedIn && !isCompleted
                    ? "The cleaner has checked in, so the date can't change."
                    : "Completed visits can't be moved to another date."}
                </span>
              ) : (
                <span className="field-hint">
                  The new time must be free and on a day the assigned cleaner works.
                </span>
              )}

              <label className="admin-booking-field">
                <span>Service status</span>
                <select
                  className="text-input"
                  value={form.status}
                  onChange={(event) =>
                    update("status", event.target.value as FormState["status"])
                  }
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                </select>
              </label>

              {saveError ? (
                <p className="form-error" role="alert">
                  {saveError}
                </p>
              ) : null}

              <div className="admin-booking-actions">
                <button type="button" className="text-button" onClick={onClose}>
                  Close
                </button>
                <button type="submit" className="confirm-button" disabled={isSaving}>
                  {isSaving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>

            <section className="admin-booking-history" aria-label="Change history">
              <h3>Change history</h3>
              {history.length === 0 ? (
                <p>No admin changes yet.</p>
              ) : (
                <ul>
                  {history.map((change) => (
                    <li key={change.id}>
                      <strong>{change.summary}</strong>
                      <span>
                        {change.adminName} · {displayDateTime(change.changedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
