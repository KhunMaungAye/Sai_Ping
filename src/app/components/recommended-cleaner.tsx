"use client";

import { useEffect, useState } from "react";
import type { RecommendedCleaner as Recommendation } from "@/lib/booking-store";

type State =
  | { status: "loading" }
  | { status: "ready"; recommendation: Recommendation | null }
  | { status: "error"; message: string };

/**
 * AI-01A: shows the recommended cleaner once a date and arrival window are picked.
 * The booking itself still goes out as an open request; this is information only.
 */
export function RecommendedCleaner({ date, time }: { date: string; time: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ date, time });

    fetch(`/api/recommendation?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as {
          recommendation?: Recommendation | null;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Recommendation unavailable.");
        setState({ status: "ready", recommendation: result.recommendation ?? null });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: reason instanceof Error ? reason.message : "Recommendation unavailable.",
        });
      });

    return () => {
      controller.abort();
      setState({ status: "loading" });
    };
  }, [date, time]);

  if (state.status === "loading") {
    return (
      <p className="recommend-note" role="status">
        Finding the best cleaner for this time…
      </p>
    );
  }

  if (state.status === "error") {
    return <p className="recommend-note">{state.message}</p>;
  }

  const cleaner = state.recommendation;
  if (!cleaner) {
    return (
      <p className="recommend-note" role="status">
        No cleaner to recommend for this time yet. You can still book: your request goes to all our
        cleaners.
      </p>
    );
  }

  const stars =
    cleaner.averageRating === null ? "New, no ratings yet" : `${cleaner.averageRating.toFixed(1)} ★`;
  const cleanings = `${cleaner.completedJobs} completed cleaning${cleaner.completedJobs === 1 ? "" : "s"}`;

  return (
    <div className="recommend-card" role="status" aria-live="polite">
      <span className="recommend-avatar" aria-hidden="true">
        {cleaner.name.trim().charAt(0).toUpperCase()}
      </span>
      <div className="recommend-body">
        <p className="recommend-label">Recommended cleaner</p>
        <p className="recommend-name">{cleaner.name}</p>
        <p className="recommend-meta">
          <span>{stars}</span>
          <span aria-hidden="true">·</span>
          <span>{cleanings}</span>
        </p>
        <p className="recommend-hint">
          {cleaner.reason === "score"
            ? "Best match on ratings and experience for this time."
            : "Most available cleaner this week."}{" "}
          Your booking goes out as an open request, so another cleaner may accept it.
        </p>
      </div>
    </div>
  );
}
