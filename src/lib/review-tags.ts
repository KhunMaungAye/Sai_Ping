// US-16: feedback tags on a rating, and the summary cleaners and admins see.
// No database code, so the rating forms, the API and node tests share it.

/**
 * Tags a customer can add to a rating. "Punctual" and "Detailed" come from the
 * card; the other two are suggestions (PO to confirm).
 */
export const REVIEW_TAGS = ["Punctual", "Detailed", "Friendly", "Professional"] as const;
export type ReviewTag = (typeof REVIEW_TAGS)[number];

export const REVIEW_MAX_LENGTH = 1000;

export type ParseTagsResult = { ok: true; tags: ReviewTag[] } | { ok: false; error: string };

/** Accepts a missing value or an array of known tags; duplicates are dropped. Keeps REVIEW_TAGS order. */
export function parseReviewTags(raw: unknown): ParseTagsResult {
  if (raw === undefined || raw === null) return { ok: true, tags: [] };
  if (!Array.isArray(raw) || raw.some((tag) => typeof tag !== "string")) {
    return { ok: false, error: "Tags must be a list of tag names." };
  }
  const unknown = raw.filter((tag) => !REVIEW_TAGS.includes(tag as ReviewTag));
  if (unknown.length) {
    return { ok: false, error: `Choose tags from: ${REVIEW_TAGS.join(", ")}.` };
  }
  return { ok: true, tags: REVIEW_TAGS.filter((tag) => raw.includes(tag)) };
}

/** Tags are stored as a JSON array; anything unreadable counts as no tags. */
export function readStoredTags(value: string | null | undefined): ReviewTag[] {
  if (!value) return [];
  try {
    const parsed = parseReviewTags(JSON.parse(value));
    return parsed.ok ? parsed.tags : [];
  } catch {
    return [];
  }
}

export type ReviewSummary = {
  count: number;
  /** One decimal, or null when there are no ratings yet. */
  average: number | null;
  /** How many ratings used each tag, most used first; unused tags left out. */
  tagCounts: Array<{ tag: ReviewTag; count: number }>;
  /** Ratings that came with written text. */
  writtenCount: number;
};

export function summarizeReviews(
  reviews: ReadonlyArray<{ stars: number; review: string | null; tags: readonly ReviewTag[] }>,
): ReviewSummary {
  const count = reviews.length;
  const total = reviews.reduce((sum, item) => sum + item.stars, 0);
  const tagCounts = REVIEW_TAGS.map((tag) => ({
    tag,
    count: reviews.filter((item) => item.tags.includes(tag)).length,
  }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  return {
    count,
    average: count ? Math.round((total / count) * 10) / 10 : null,
    tagCounts,
    writtenCount: reviews.filter((item) => item.review).length,
  };
}

export const NO_REVIEWS_MESSAGE = "No ratings or reviews yet.";
