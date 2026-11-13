"use client";

import { useEffect, useState } from "react";
import type { CustomerSubscription } from "@/lib/booking-store";
import { SERVICES, SPECIAL_INSTRUCTIONS_MAX_LENGTH, TIME_SLOTS } from "@/lib/services";
import { NO_CHANGES_MESSAGE } from "@/lib/subscription-changes";

const MAX_PAUSE_DAYS = 365;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function formatPrice(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

function displayDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function displayTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2000, 0, 1, hours, minutes),
  );
}

type Notice = { tone: "success" | "error"; text: string };
type PlanAction = "skip" | "pause" | "resume" | "update";
type PendingConfirm = { action: Exclude<PlanAction, "resume">; body: object; text: string };

/** US-04: the editable fields of a plan, as the form holds them. */
type PlanDraft = {
  serviceId: string;
  frequency: string;
  preferredDay: string;
  time: string;
  address: string;
  specialInstructions: string;
};

function draftFrom(plan: CustomerSubscription): PlanDraft {
  return {
    serviceId: plan.serviceId,
    frequency: plan.frequency,
    preferredDay: plan.preferredDay,
    time: plan.time,
    address: plan.address,
    specialInstructions: plan.specialInstructions ?? "",
  };
}

/** Only the fields the customer actually changed, so the server changes nothing else. */
function changedFields(plan: CustomerSubscription, draft: PlanDraft) {
  const before = draftFrom(plan);
  const body: Record<string, string> = {};
  if (draft.serviceId !== before.serviceId) body.serviceId = draft.serviceId;
  if (draft.frequency !== before.frequency) body.frequency = draft.frequency;
  if (draft.preferredDay !== before.preferredDay) body.preferredDay = draft.preferredDay;
  if (draft.time !== before.time) body.time = draft.time;
  if (draft.address.trim() !== before.address) body.address = draft.address.trim();
  if (draft.specialInstructions.trim() !== before.specialInstructions.trim()) {
    body.specialInstructions = draft.specialInstructions.trim();
  }
  return body;
}

/**
 * US-15: the customer's weekly / fortnightly plans with "Skip next date" and a
 * "Pause subscription" toggle (with a resume-date picker).
 */
export function RecurringPlans({ onChanged }: { onChanged?: () => void }) {
  const [plans, setPlans] = useState<CustomerSubscription[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/customer/subscriptions", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load your recurring plans.");
        return (await res.json()) as { subscriptions: CustomerSubscription[] };
      })
      .then((data) => {
        setPlans(data.subscriptions);
        setLoadError("");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : "Could not load your recurring plans.");
      });
    return () => controller.abort();
  }, [reload]);

  if (loadError) {
    return (
      <div className="form-error" role="alert">
        {loadError}{" "}
        <button type="button" className="text-button" onClick={() => setReload((v) => v + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (!plans) {
    return <p className="empty-subtext">Loading your recurring plans…</p>;
  }
  if (plans.length === 0) {
    return (
      <div className="plan-empty">
        <h3>No recurring plans yet</h3>
        <p>
          Choose <strong>Weekly</strong> or <strong>Every 2 Weeks</strong> when you book a
          cleaning, and you can skip or pause it here.
        </p>
      </div>
    );
  }

  return (
    <div className="plan-list">
      {plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          onUpdated={(updated) => {
            setPlans((current) =>
              current ? current.map((p) => (p.id === updated.id ? updated : p)) : current,
            );
            onChanged?.();
          }}
        />
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  onUpdated,
}: {
  plan: CustomerSubscription;
  onUpdated: (plan: CustomerSubscription) => void;
}) {
  const today = todayString();
  const isPaused = plan.status === "paused";
  const [showPausePicker, setShowPausePicker] = useState(false);
  const [resumeDate, setResumeDate] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [draft, setDraft] = useState<PlanDraft>(() => draftFrom(plan));
  const [busy, setBusy] = useState<"" | PlanAction>("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const minResume = addDays(today, 1);
  const maxResume = [addDays(today, MAX_PAUSE_DAYS), plan.lastVisitDate ?? addDays(today, MAX_PAUSE_DAYS)].sort()[0];
  const canChange = plan.status !== "cancelled";

  async function send(action: PlanAction, body: object = {}) {
    setBusy(action);
    setNotice(null);
    setPendingConfirm(null);
    try {
      const res = await fetch(`/api/subscriptions/${plan.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
        needsConfirmation?: boolean;
        subscription?: CustomerSubscription;
      } | null;
      if (res.status === 409 && data?.needsConfirmation && action !== "resume") {
        // A cleaner already accepted a visit this would remove: ask first.
        setPendingConfirm({ action, body: { ...body, confirmAccepted: true }, text: data.error ?? "" });
        return;
      }
      if (!res.ok || !data?.subscription) {
        setNotice({ tone: "error", text: data?.error || "Something went wrong. Please try again." });
        return;
      }
      // AC2/AC3: the confirmation only appears after the server saved the change.
      setNotice({ tone: "success", text: data.message || "Saved." });
      setShowPausePicker(false);
      setResumeDate("");
      setShowEdit(false);
      setDraft(draftFrom(data.subscription));
      onUpdated(data.subscription);
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setBusy("");
    }
  }

  function validateResumeDate(): string | null {
    if (!resumeDate) return "Pick the date your cleanings should start again.";
    if (resumeDate <= today) return "Choose a resume date after today.";
    if (resumeDate > maxResume) {
      return `Choose a date on or before ${displayDate(maxResume)}.`;
    }
    return null;
  }

  function onToggle() {
    if (busy) return;
    if (isPaused) {
      void send("resume");
    } else {
      setNotice(null);
      setShowEdit(false);
      setShowPausePicker((open) => !open);
    }
  }

  function toggleEdit() {
    if (busy) return;
    setNotice(null);
    setPendingConfirm(null);
    setShowPausePicker(false);
    setDraft(draftFrom(plan));
    setShowEdit((open) => !open);
  }

  function submitEdit() {
    const body = changedFields(plan, draft);
    if (Object.keys(body).length === 0) {
      setNotice({ tone: "error", text: NO_CHANGES_MESSAGE });
      return;
    }
    if ("address" in body && body.address.length < 5) {
      setNotice({ tone: "error", text: "Enter the full service address." });
      return;
    }
    void send("update", body);
  }

  function setField(field: keyof PlanDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setNotice(null);
  }

  const statusLabel = isPaused ? "Paused" : plan.status === "cancelled" ? "Cancelled" : "Active";

  return (
    <article className="plan-card" aria-labelledby={`plan-${plan.id}`}>
      <header className="plan-card-head">
        <div>
          <h3 id={`plan-${plan.id}`}>{plan.serviceName}</h3>
          <p>
            {plan.frequency === "weekly" ? "Every week" : "Every 2 weeks"} on {plan.preferredDay}s ·{" "}
            {displayTime(plan.time)}
          </p>
        </div>
        <span className={`plan-status is-${plan.status}`}>{statusLabel}</span>
      </header>

      <div className="plan-next">
        {isPaused && plan.pausedUntil ? (
          <span>
            Paused until <strong>{displayDate(plan.pausedUntil)}</strong>
            {plan.nextVisit ? <> · next cleaning {displayDate(plan.nextVisit.date)}</> : null}
          </span>
        ) : plan.nextVisit ? (
          <span>
            Next cleaning: <strong>{displayDate(plan.nextVisit.date)}</strong>
          </span>
        ) : (
          <span>No upcoming visits left on this plan.</span>
        )}
        <span className="plan-meta">{plan.upcomingVisits.length} upcoming visit{plan.upcomingVisits.length === 1 ? "" : "s"}</span>
      </div>

      {canChange ? (
        <div className="plan-actions">
          <button
            type="button"
            className="sunny-button small"
            disabled={!plan.nextVisit || isPaused || busy !== ""}
            onClick={() => plan.nextVisit && send("skip", { date: plan.nextVisit.date })}
            title={isPaused ? "Resume the plan to skip a single visit" : undefined}
          >
            {busy === "skip" ? "Skipping…" : "Skip next date"}
          </button>

          <button
            type="button"
            className="plan-edit-button"
            aria-expanded={showEdit}
            aria-controls={`plan-edit-${plan.id}`}
            disabled={!plan.nextVisit || busy !== ""}
            onClick={toggleEdit}
          >
            {showEdit ? "Close editor" : "Edit plan"}
          </button>

          <label className="plan-toggle">
            <button
              type="button"
              role="switch"
              aria-checked={isPaused || showPausePicker}
              className={`switch${isPaused || showPausePicker ? " is-on" : ""}`}
              onClick={onToggle}
              disabled={busy !== "" || (!isPaused && !plan.nextVisit)}
            >
              <span className="switch-knob" aria-hidden="true" />
            </button>
            <span>{busy === "resume" ? "Resuming…" : isPaused ? "Paused — switch off to resume now" : "Pause subscription"}</span>
          </label>
        </div>
      ) : null}

      {showPausePicker && !isPaused ? (
        <form
          className="plan-pause-form"
          onSubmit={(event) => {
            event.preventDefault();
            const error = validateResumeDate();
            if (error) {
              setNotice({ tone: "error", text: error });
              return;
            }
            void send("pause", { resumeDate });
          }}
        >
          <label className="auth-field">
            <span className="field-label">Resume cleanings on</span>
            <input
              type="date"
              className="text-input"
              min={minResume}
              max={maxResume}
              value={resumeDate}
              onChange={(e) => {
                setResumeDate(e.target.value);
                setNotice(null);
              }}
              required
            />
          </label>
          <p className="plan-hint">
            Visits before this date won&apos;t happen and won&apos;t be charged. Your plan restarts by itself on
            the first visit from this date.
          </p>
          <div className="plan-pause-buttons">
            <button type="submit" className="sunny-button small" disabled={busy !== ""}>
              {busy === "pause" ? "Pausing…" : "Pause until this date"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setShowPausePicker(false);
                setNotice(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {showEdit ? (
        <form
          id={`plan-edit-${plan.id}`}
          className="plan-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitEdit();
          }}
        >
          <p className="plan-hint">
            Changes apply to your upcoming visits. Past and completed cleanings stay as they were.
          </p>
          <div className="plan-edit-grid">
            <label className="auth-field">
              <span className="field-label">Service</span>
              <select
                className="text-input"
                value={draft.serviceId}
                onChange={(e) => setField("serviceId", e.target.value)}
              >
                {SERVICES.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} · {formatPrice(service.priceCents)}
                  </option>
                ))}
              </select>
            </label>

            <label className="auth-field">
              <span className="field-label">How often</span>
              <select
                className="text-input"
                value={draft.frequency}
                disabled={isPaused}
                onChange={(e) => setField("frequency", e.target.value)}
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
              </select>
            </label>

            <label className="auth-field">
              <span className="field-label">Day</span>
              <select
                className="text-input"
                value={draft.preferredDay}
                disabled={isPaused}
                onChange={(e) => setField("preferredDay", e.target.value)}
              >
                {WEEKDAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>

            <label className="auth-field">
              <span className="field-label">Arrival time</span>
              <select
                className="text-input"
                value={draft.time}
                disabled={isPaused}
                onChange={(e) => setField("time", e.target.value)}
              >
                {TIME_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {displayTime(slot)}
                  </option>
                ))}
              </select>
            </label>

            <label className="auth-field plan-edit-wide">
              <span className="field-label">Service address</span>
              <input
                type="text"
                className="text-input"
                value={draft.address}
                maxLength={300}
                autoComplete="street-address"
                onChange={(e) => setField("address", e.target.value)}
              />
            </label>

            <label className="auth-field plan-edit-wide">
              <span className="field-label">Special instructions (optional)</span>
              <textarea
                className="text-input"
                rows={3}
                value={draft.specialInstructions}
                maxLength={SPECIAL_INSTRUCTIONS_MAX_LENGTH}
                onChange={(e) => setField("specialInstructions", e.target.value)}
              />
              <span className="plan-edit-count">
                {draft.specialInstructions.length}/{SPECIAL_INSTRUCTIONS_MAX_LENGTH}
              </span>
            </label>
          </div>

          {isPaused ? (
            <p className="plan-hint">Resume the plan to change its day, time or how often it repeats.</p>
          ) : null}

          <div className="plan-pause-buttons">
            <button type="submit" className="sunny-button small" disabled={busy !== ""}>
              {busy === "update" ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setShowEdit(false);
                setNotice(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {pendingConfirm ? (
        <div className="plan-warning" role="alert">
          <span>{pendingConfirm.text}</span>
          <div className="plan-pause-buttons">
            <button
              type="button"
              className="sunny-button small"
              disabled={busy !== ""}
              onClick={() => void send(pendingConfirm.action, pendingConfirm.body)}
            >
              {pendingConfirm.action === "skip"
                ? "Skip anyway"
                : pendingConfirm.action === "update"
                  ? "Change anyway"
                  : "Pause anyway"}
            </button>
            <button type="button" className="text-button" onClick={() => setPendingConfirm(null)}>
              Go back
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className={notice.tone === "error" ? "form-error" : "plan-success"} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      {plan.skippedVisits.length ? (
        <p className="plan-meta">
          Skipped or paused:{" "}
          {plan.skippedVisits.map((skip) => displayDate(skip.date)).join(", ")}
        </p>
      ) : null}
    </article>
  );
}
