"use client";

import { useEffect, useState } from "react";
import type { ShiftDraft } from "@/lib/shift-draft";

const TIME_LABELS: Record<string, string> = { "09:00": "9:00 AM", "14:00": "2:00 PM" };
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function displayDay(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function displayTime(value: string) {
  if (TIME_LABELS[value]) return TIME_LABELS[value];
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${suffix}`;
}

type Week = { weekStart: string; weekEnd: string };

/**
 * AI-02B: the admin's "Weekly Shifts" tab. Generate a draft for next week,
 * check each cleaner's hours, change any job's cleaner, then publish.
 */
export function ShiftDraftPanel({ onPublished }: { onPublished?: () => void }) {
  const [week, setWeek] = useState<Week | null>(null);
  const [draft, setDraft] = useState<ShiftDraft | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"generate" | "publish" | string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/shift-draft", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "The shift draft could not be loaded.");
        setWeek(data.week);
        setDraft(data.draft);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "The shift draft could not be loaded.");
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  async function send(url: string, init: RequestInit, key: string) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error ?? "Something went wrong. Please try again.");
      if (data.week) setWeek(data.week);
      setDraft(data.draft ?? null);
      if (data.message) setMessage(data.message);
      return data;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function generate() {
    void send("/api/admin/shift-draft", { method: "POST" }, "generate");
  }

  async function publish() {
    const data = await send("/api/admin/shift-draft/publish", { method: "POST" }, "publish");
    if (data) onPublished?.();
  }

  function changeCleaner(bookingId: string, cleanerId: string) {
    void send(
      `/api/admin/shift-draft/items/${encodeURIComponent(bookingId)}`,
      { method: "PATCH", body: JSON.stringify({ cleanerId: cleanerId || null }) },
      bookingId,
    );
  }

  const isDraft = draft?.status === "draft";
  const weekLabel = week ? `${displayDay(week.weekStart)} – ${displayDay(week.weekEnd)}` : "";
  const flagged = draft?.items.filter((item) => item.flag).length ?? 0;

  return (
    <section className="tab-panel shift-panel" aria-labelledby="shift-panel-title">
      <div className="shift-panel-head">
        <div>
          <h2 id="shift-panel-title">Next week&apos;s shifts</h2>
          <p>
            {weekLabel ? `${weekLabel}. ` : ""}Drafts a cleaner for every job no cleaner has accepted, within{" "}
            {draft?.hourCap ?? 35} hours each and with travel time between jobs.
          </p>
        </div>
        <div className="shift-panel-actions">
          <button
            type="button"
            className="manage-shift-button"
            onClick={generate}
            disabled={busy !== null || status === "loading"}
          >
            {busy === "generate" ? "Generating…" : draft ? "Generate new draft" : "Generate draft"}
          </button>
          {isDraft ? (
            <button
              type="button"
              className="confirm-button shift-publish-button"
              onClick={publish}
              disabled={busy !== null}
            >
              {busy === "publish" ? "Publishing…" : "Publish draft"}
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <p className="success-banner" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {status === "loading" ? <p className="shift-empty">Loading…</p> : null}

      {status === "ready" && !draft ? (
        <p className="shift-empty">No draft yet. Generate one to see who could take next week&apos;s jobs.</p>
      ) : null}

      {draft ? (
        <>
          <p className={`shift-state shift-state-${draft.status}`}>
            {draft.status === "published"
              ? "Published: these jobs are now in the cleaners' lists."
              : `Draft, not final yet${flagged > 0 ? ` · ${flagged} job${flagged === 1 ? "" : "s"} need attention` : ""}`}
          </p>

          <ul className="shift-cleaner-list" aria-label="Hours per cleaner">
            {draft.cleaners.map((cleaner) => {
              const percent = Math.min(100, Math.round((cleaner.hours / draft.hourCap) * 100));
              return (
                <li key={cleaner.id} className="shift-cleaner">
                  <div className="shift-cleaner-top">
                    <strong>{cleaner.name}</strong>
                    <span>
                      {cleaner.hours} / {draft.hourCap} h
                    </span>
                  </div>
                  <div
                    className="shift-hours-bar"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={draft.hourCap}
                    aria-valuenow={cleaner.hours}
                    aria-label={`${cleaner.name}: ${cleaner.hours} of ${draft.hourCap} hours`}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <span className="shift-cleaner-meta">
                    {cleaner.jobs} job{cleaner.jobs === 1 ? "" : "s"} · works{" "}
                    {cleaner.workingDays.map((d) => DAY_SHORT[d]).join(", ") || "no days"}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="table-responsive-wrapper">
            <table className="admin-table shift-table">
              <thead>
                <tr>
                  <th>Day & arrival</th>
                  <th>Job</th>
                  <th>Cleaner</th>
                </tr>
              </thead>
              <tbody>
                {draft.items.map((item) => (
                  <tr key={item.bookingId} className={item.flag ? "is-flagged" : undefined}>
                    <td>
                      {item.date ? (
                        <div className="shift-cell">
                          <strong>{displayDay(item.date)}</strong>
                          <span>
                            {displayTime(item.time)} · {item.hours} h
                          </span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className="shift-cell">
                        <strong>{item.serviceName || "Cancelled booking"}</strong>
                        <span>
                          {item.customerName}
                          {item.address ? ` · ${item.address}` : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      {isDraft && item.date ? (
                        <select
                          className="text-input shift-select"
                          value={item.cleanerId ?? ""}
                          disabled={busy !== null}
                          aria-label={`Cleaner for ${item.serviceName} on ${displayDay(item.date)}`}
                          onChange={(event) => changeCleaner(item.bookingId, event.target.value)}
                        >
                          <option value="">No cleaner</option>
                          {draft.cleaners.map((cleaner) => (
                            <option key={cleaner.id} value={cleaner.id}>
                              {cleaner.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span>{item.cleanerName ?? "No cleaner"}</span>
                      )}
                      {item.flag ? <span className="shift-flag">{item.flag}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
