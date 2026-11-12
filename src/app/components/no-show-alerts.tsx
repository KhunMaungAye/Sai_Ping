"use client";

import { useCallback, useEffect, useState } from "react";
import type { NoShowAlert } from "@/lib/booking-store";

/** How often the admin dashboard checks for new no-shows. */
const POLL_MS = 60 * 1000;

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function displaySlot(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2000, 0, 1, hour, minute),
  );
}

function clockTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(iso));
}

/**
 * US-09: loads no-show alerts on mount and every minute. Each request also
 * runs the no-show check on the server, so new alerts appear on their own.
 */
export function useNoShowAlerts(enabled: boolean) {
  const [open, setOpen] = useState<NoShowAlert[]>([]);
  const [resolved, setResolved] = useState<NoShowAlert[]>([]);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((v) => v + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/admin/no-shows", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("bad status");
        const data = (await res.json()) as { open?: NoShowAlert[]; resolved?: NoShowAlert[] };
        setOpen(data.open ?? []);
        setResolved(data.resolved ?? []);
        setError("");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Keep showing the last alerts we had.
        setError("Could not check for no-shows. Retrying in a minute.");
      });
    const timer = setTimeout(reload, POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, tick, reload]);

  return { open, resolved, error, reload };
}

/** Red banner across the top of the admin dashboard while alerts are open. */
export function NoShowBanner({ count, onView }: { count: number; onView: () => void }) {
  if (count === 0) return null;
  return (
    <div className="form-error no-show-banner" role="alert">
      <strong>
        {count === 1 ? "A cleaner hasn't arrived for a job." : `${count} cleaners haven't arrived for their jobs.`}
      </strong>{" "}
      <button type="button" className="text-button" onClick={onView}>
        View no-shows
      </button>
    </div>
  );
}

export function NoShowAlertsPanel({
  open,
  resolved,
  error,
  onChanged,
}: {
  open: NoShowAlert[];
  resolved: NoShowAlert[];
  error: string;
  onChanged: () => void;
}) {
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  return (
    <section className="tab-panel" aria-labelledby="no-shows-heading">
      <div className="section-divider-header">
        <h2 id="no-shows-heading">Cleaner no-shows</h2>
      </div>
      <p className="field-hint">
        A job is flagged when its cleaner hasn&apos;t checked in 15 minutes after the arrival time
        (or after the delay they reported). Checked every minute.
      </p>
      {error ? (
        <p className="form-error" role="status">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className={message.isError ? "form-error" : "success-banner"} role="status">
          {message.text}
        </p>
      ) : null}

      {open.length === 0 ? (
        <div className="empty-bookings-card">
          <div className="empty-icon-circle" aria-hidden="true">
            ✓
          </div>
          <h3>No open no-show alerts</h3>
          <p>Every cleaner due so far today has checked in.</p>
        </div>
      ) : (
        <div className="booking-card-list">
          {open.map((alert) => (
            <OpenAlertCard
              key={alert.id}
              alert={alert}
              onDone={(text, isError) => {
                setMessage({ text, isError });
                onChanged();
              }}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 ? (
        <div className="cancelled-bookings-group">
          <div className="section-divider-header">
            <h2>Recently resolved</h2>
          </div>
          <ul className="cancelled-bookings-list">
            {resolved.map((alert) => (
              <li key={alert.id} className="cancelled-booking-row">
                <div>
                  <span>
                    {alert.bookingId.slice(0, 8).toUpperCase()} · {displayDate(alert.date)} ·{" "}
                    {displaySlot(alert.time)} · {alert.cleanerName}
                  </span>
                  <span>
                    {alert.resolution === "reassigned"
                      ? `Reassigned to ${alert.reassignedToName}`
                      : alert.resolution === "cleaner-arrived"
                        ? "Cleaner checked in late"
                        : "Marked resolved"}
                    {alert.resolvedAt ? ` at ${clockTime(alert.resolvedAt)}` : ""}
                    {alert.resolvedBy && alert.resolution !== "cleaner-arrived" ? ` by ${alert.resolvedBy}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function OpenAlertCard({
  alert,
  onDone,
}: {
  alert: NoShowAlert;
  onDone: (message: string, isError: boolean) => void;
}) {
  const [replacement, setReplacement] = useState(alert.replacements[0]?.id ?? "");
  const [busy, setBusy] = useState<"reassign" | "resolve" | null>(null);

  async function resolve(action: "reassign" | "resolve") {
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/no-shows/${alert.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "reassign" ? { action, cleanerId: replacement } : { action }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Could not resolve the alert.");
      onDone(data?.message ?? "Alert resolved.", false);
    } catch (err) {
      onDone(err instanceof Error ? err.message : "Could not resolve the alert.", true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="customer-booking-card no-show-card">
      <div className="booking-card-header">
        <div className="service-title-wrap">
          <span className="booking-service-title">{alert.cleanerName} hasn&apos;t arrived</span>
          <span className="field-hint">
            {alert.serviceName} for {alert.customerName}
          </span>
        </div>
        <span className="status-badge no-show-alert-badge">
          <span className="status-indicator-dot" aria-hidden="true" />
          No-show
        </span>
      </div>

      <div className="booking-card-grid">
        <div className="booking-detail-item">
          <span className="detail-label">Booking ID</span>
          <strong className="detail-value">{alert.bookingId.slice(0, 8).toUpperCase()}</strong>
        </div>
        <div className="booking-detail-item">
          <span className="detail-label">Cleaner</span>
          <strong className="detail-value">{alert.cleanerName}</strong>
        </div>
        <div className="booking-detail-item">
          <span className="detail-label">Date</span>
          <strong className="detail-value">{displayDate(alert.date)}</strong>
        </div>
        <div className="booking-detail-item">
          <span className="detail-label">Time</span>
          <strong className="detail-value">{displaySlot(alert.time)}</strong>
        </div>
        <div className="booking-detail-item booking-detail-span-full">
          <span className="detail-label">Location</span>
          <span className="detail-value-text">{alert.address}</span>
        </div>
        <div className="booking-detail-item booking-detail-span-full">
          <span className="detail-label">Details</span>
          <span className="detail-value-text">
            Expected by {clockTime(alert.expectedBy)}
            {alert.lateMinutes ? ` (reported ${alert.lateMinutes} min late)` : ""}. Alert raised at{" "}
            {clockTime(alert.detectedAt)}. Customer: {alert.customerEmail}
          </span>
        </div>
      </div>

      <div className="no-show-actions">
        {alert.replacements.length > 0 ? (
          <>
            <select
              aria-label="Replacement cleaner"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              disabled={busy !== null}
            >
              {alert.replacements.map((cleaner) => (
                <option key={cleaner.id} value={cleaner.id}>
                  {cleaner.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="confirm-button"
              disabled={busy !== null || !replacement}
              onClick={() => resolve("reassign")}
            >
              {busy === "reassign" ? "Reassigning…" : "Reassign job"}
            </button>
          </>
        ) : (
          <span className="field-hint">No other cleaner works this day.</span>
        )}
        <button
          type="button"
          className="no-show-resolve-button"
          disabled={busy !== null}
          onClick={() => resolve("resolve")}
        >
          {busy === "resolve" ? "Saving…" : "Mark resolved"}
        </button>
      </div>
    </article>
  );
}
