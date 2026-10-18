"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BookingDetails = {
  id: string;
  serviceName: string;
  date: string;
  status: "scheduled" | "completed";
  cleanerId: string;
  cleanerName: string;
  rating: number | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export default function RatingForm({ bookingId }: { bookingId: string }) {
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [stars, setStars] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [isRated, setIsRated] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/bookings/${encodeURIComponent(bookingId)}/rating`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          booking?: BookingDetails;
          error?: string;
        };
        if (!response.ok || !result.booking) {
          throw new Error(result.error ?? "Booking could not be found.");
        }
        setBooking(result.booking);
        if (result.booking.rating !== null) {
          setStars(result.booking.rating);
          setIsRated(true);
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Booking could not be found.",
        );
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [bookingId, refresh]);

  async function submitRating() {
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/bookings/${encodeURIComponent(bookingId)}/rating`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stars }),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        stars?: number;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Your rating could not be saved.");
      setStars(result.stars ?? stars);
      setIsRated(true);
      setBooking((current) =>
        current ? { ...current, rating: result.stars ?? stars } : current,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your rating could not be saved.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rating-page" aria-labelledby="rating-title">
      <p className="eyebrow">CUSTOMER FEEDBACK</p>
      <h1 id="rating-title">Rate your cleaner</h1>

      {isLoading ? (
        <p className="rating-message" role="status">
          Loading booking…
        </p>
      ) : null}
      {!isLoading && error && !booking ? (
        <div className="rating-panel">
          <p className="form-error" role="alert">
            {error}
          </p>
          <Link className="text-link" href="/">
            Return to booking
          </Link>
        </div>
      ) : null}
      {!isLoading && booking ? (
        <div className="rating-panel">
          <div className="rating-booking-details">
            <p className="rating-service">{booking.serviceName}</p>
            <p>{formatDate(booking.date)}</p>
            <p>
              Cleaner: <strong>{booking.cleanerName}</strong>
            </p>
          </div>

          {booking.status !== "completed" ? (
            <div className="rating-locked" role="status">
              <span className="lock-symbol" aria-hidden="true">
                ◷
              </span>
              <h2>Rating opens after your service</h2>
              <p>
                Your cleaner must mark this booking completed before you can
                leave a rating.
              </p>
              <button
                className="inline-button"
                type="button"
                onClick={() => {
                  setError("");
                  setRefresh((value) => value + 1);
                }}
              >
                Check completion status
              </button>
            </div>
          ) : isRated ? (
            <div className="rating-thanks" role="status">
              <p className="eyebrow">RATING SAVED</p>
              <div
                className="rating-stars saved-stars"
                aria-label={`${stars} out of 5 stars`}
              >
                {Array.from({ length: 5 }, (_, index) => (
                  <span
                    key={index}
                    className={index < stars ? "is-filled" : ""}
                  >
                    ★
                  </span>
                ))}
              </div>
              <h2>Thank you for sharing your experience.</h2>
              <p>
                Your {stars}-star rating is saved with this completed service.
              </p>
            </div>
          ) : (
            <div className="rating-entry">
              <p className="rating-prompt">How was your cleaning experience?</p>
              <div
                className="rating-stars"
                role="group"
                aria-label="Choose a rating from 1 to 5 stars"
              >
                {Array.from({ length: 5 }, (_, index) => {
                  const value = index + 1;
                  return (
                    <button
                      key={value}
                      type="button"
                      className={value <= stars ? "is-filled" : ""}
                      aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
                      aria-pressed={stars === value}
                      onClick={() => setStars(value)}
                    >
                      ★
                    </button>
                  );
                })}
              </div>
              <p className="rating-scale">
                {stars ? `${stars} out of 5 stars` : "Select a rating"}
              </p>
              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                className="confirm-button rating-submit"
                type="button"
                disabled={!stars || isSubmitting}
                onClick={submitRating}
              >
                {isSubmitting ? "Saving rating…" : "Submit rating"}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
