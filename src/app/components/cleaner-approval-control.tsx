"use client";

import { useState } from "react";

/**
 * US-19: lets the admin approve a cleaner's application with one click, or
 * reject it with a required reason (shown to the cleaner on their dashboard).
 */
export function CleanerApprovalControl({
  cleanerId,
  approvalStatus,
  onDone,
}: {
  cleanerId: string;
  approvalStatus: "pending" | "approved" | "rejected";
  onDone: (message: string, isError: boolean) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(action: "approve" | "reject") {
    if (action === "reject" && !note.trim()) {
      onDone("Give a reason for rejecting this application.", true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/cleaners/${cleanerId}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: action === "reject" ? note.trim() : undefined }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) {
        onDone(data?.error || "Could not update the application.", true);
        return;
      }
      setRejecting(false);
      setNote("");
      onDone(data?.message || "Application updated.", false);
    } catch {
      onDone("Could not reach the server. Please try again.", true);
    } finally {
      setSaving(false);
    }
  }

  if (rejecting) {
    return (
      <div className="approval-reject-box">
        <textarea
          className="text-input"
          rows={2}
          maxLength={500}
          placeholder="Reason for rejecting (shown to the applicant)"
          value={note}
          disabled={saving}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="approval-reject-actions">
          <button
            type="button"
            className="reassign-save"
            disabled={saving || !note.trim()}
            onClick={() => submit("reject")}
          >
            {saving ? "Saving…" : "Confirm reject"}
          </button>
          <button
            type="button"
            className="reassign-link"
            disabled={saving}
            onClick={() => {
              setRejecting(false);
              setNote("");
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="approval-actions">
      {approvalStatus !== "approved" ? (
        <button
          type="button"
          className="reassign-link"
          disabled={saving}
          onClick={() => submit("approve")}
        >
          Approve
        </button>
      ) : null}
      {approvalStatus !== "rejected" ? (
        <button
          type="button"
          className="approval-reject-link"
          disabled={saving}
          onClick={() => setRejecting(true)}
        >
          Reject
        </button>
      ) : null}
    </div>
  );
}
