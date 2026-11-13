"use client";

import { useEffect, useState } from "react";
import { NO_REVIEWS_MESSAGE, type ReviewSummary, type ReviewTag } from "@/lib/review-tags";
import { ReviewTagList } from "./review-tags";

type CleanerReview = {
  bookingId: string;
  serviceName: string;
  serviceDate: string;
  customerName: string;
  stars: number;
  review: string | null;
  tags: ReviewTag[];
  createdAt: string;
};

function displayDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function StarRow({ value }: { value: number }) {
  return (
    <span className="review-stars" aria-label={`${value} out of 5 stars`}>
      {"★".repeat(value)}
      <span className="review-stars-empty">{"★".repeat(5 - value)}</span>
    </span>
  );
}

/** US-16: average rating, tag counts and a sentence summary for a list of reviews. */
export function ReviewSummaryBar({ summary, title }: { summary: ReviewSummary; title: string }) {
  return (
    <div className="review-summary" aria-label={title}>
      <div className="review-summary-score">
        <strong>{summary.average === null ? "–" : summary.average.toFixed(1)}</strong>
        <span>
          average from {summary.count} rating{summary.count === 1 ? "" : "s"}
          {summary.writtenCount ? ` · ${summary.writtenCount} written` : ""}
        </span>
      </div>
      {summary.tagCounts.length ? (
        <ul className="review-tag-list" aria-label="Most mentioned">
          {summary.tagCounts.map(({ tag, count }) => (
            <li key={tag} className="review-tag-chip">
              {tag} × {count}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * US-16: the cleaner's own ratings and written reviews. The server only ever
 * returns the signed-in cleaner's feedback.
 */
export function CleanerReviews() {
  const [data, setData] = useState<{ summary: ReviewSummary; reviews: CleanerReview[] } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cleaner/reviews", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { summary?: ReviewSummary; reviews?: CleanerReview[]; error?: string }
          | null;
        if (!res.ok || !body?.summary || !body.reviews) {
          throw new Error(body?.error || "Could not load your reviews.");
        }
        setData({ summary: body.summary, reviews: body.reviews });
        setError("");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load your reviews.");
      });
    return () => controller.abort();
  }, [attempt]);

  if (error) {
    return (
      <p className="form-error" role="alert">
        {error}{" "}
        <button type="button" className="text-button" onClick={() => setAttempt((v) => v + 1)}>
          Try again
        </button>
      </p>
    );
  }
  if (!data) return <p className="field-hint">Loading your reviews…</p>;
  if (data.reviews.length === 0) {
    return (
      <div className="empty-bookings-card">
        <div className="empty-icon-circle" aria-hidden="true">
          ★
        </div>
        <h3>{NO_REVIEWS_MESSAGE}</h3>
        <p>Customers can rate you after you mark a cleaning completed. Their feedback will show here.</p>
      </div>
    );
  }

  return (
    <div className="cleaner-reviews">
      <ReviewSummaryBar summary={data.summary} title="Your rating summary" />
      <div className="review-list">
        {data.reviews.map((r) => (
          <article key={r.bookingId} className="review-card">
            <div className="review-card-header">
              <StarRow value={r.stars} />
              <span className="review-meta">{displayDate(r.createdAt)}</span>
            </div>
            <p className="review-text">
              {r.review ? `“${r.review}”` : <em style={{ color: "var(--muted)" }}>No written review</em>}
            </p>
            <ReviewTagList tags={r.tags} />
            <p className="review-meta">
              <strong>{r.customerName}</strong> · {r.serviceName} on {displayDate(r.serviceDate)}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
