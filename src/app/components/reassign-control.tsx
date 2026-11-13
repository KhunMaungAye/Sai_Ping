"use client";

import { useEffect, useState } from "react";
import { bangkokDateString } from "@/lib/date-utils";

type CleanerOption = { id: string; name: string };

/**
 * US-10: lets the admin move a booking to another available cleaner (an active
 * cleaner who works that weekday). The list comes from the server, so it never
 * offers someone who can't take the job.
 */
export function ReassignControl({
  bookingId,
  date,
  hasCleaner,
  onDone,
}: {
  bookingId: string;
  /** The booking's date; past bookings can't be reassigned (the server checks too). */
  date: string;
  hasCleaner: boolean;
  onDone: (message: string, isError: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cleaners, setCleaners] = useState<CleanerOption[] | null>(null);
  const [choice, setChoice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/admin/bookings/${bookingId}/reassign`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as
          | { cleaners?: CleanerOption[]; error?: string }
          | null;
        if (!res.ok || !data?.cleaners) throw new Error(data?.error || "Could not load cleaners.");
        setCleaners(data.cleaners);
        setChoice(data.cleaners[0]?.id ?? "");
        setLoadError("");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : "Could not load cleaners.");
      });
    return () => controller.abort();
  }, [open, bookingId]);

  async function save() {
    if (!choice || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanerId: choice }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) {
        onDone(data?.error || "Could not reassign the booking.", true);
        return;
      }
      setOpen(false);
      setCleaners(null);
      onDone(data?.message || "Booking reassigned.", false);
    } catch {
      onDone("Could not reach the server. Please try again.", true);
    } finally {
      setSaving(false);
    }
  }

  const label = hasCleaner ? "Reassign" : "Assign";

  // Only rendered for loaded table rows, so reading the clock here is safe.
  if (date < bangkokDateString()) return null;

  if (!open) {
    return (
      <button type="button" className="reassign-link" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="reassign-box">
      {loadError ? (
        <span className="reassign-note">{loadError}</span>
      ) : !cleaners ? (
        <span className="reassign-note">Loading cleaners…</span>
      ) : cleaners.length === 0 ? (
        <span className="reassign-note">No other cleaner works on this day.</span>
      ) : (
        <>
          <label className="reassign-label">
            <span>{label} to</span>
            <select value={choice} onChange={(event) => setChoice(event.target.value)}>
              {cleaners.map((cleaner) => (
                <option key={cleaner.id} value={cleaner.id}>
                  {cleaner.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="reassign-save" disabled={!choice || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      )}
      <button
        type="button"
        className="reassign-link"
        onClick={() => {
          setOpen(false);
          setLoadError("");
        }}
      >
        Cancel
      </button>
    </div>
  );
}
