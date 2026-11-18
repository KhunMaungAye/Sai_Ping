// US-17B: helpers for the admin cleaner rating summary.
// Kept free of database code so the client page and node tests can both use them.

export type CleanerRatingSort = "name" | "rating-asc";

type RatedCleaner = {
  name: string;
  averageRating: number | null;
  reviewCount: number;
};

/** Average stars to one decimal place, or "No ratings yet" when there are none. */
export function formatAverageRating(averageRating: number | null): string {
  return averageRating === null ? "No ratings yet" : averageRating.toFixed(1);
}

/**
 * Returns a sorted copy of the cleaner list.
 *
 * "rating-asc" puts the lowest average first so quality problems show at the
 * top. On equal averages, the cleaner with more ratings comes first because
 * that low score is better evidenced. Cleaners with no ratings have nothing
 * to compare, so they go last. Remaining ties are sorted by name.
 */
export function sortCleanerSummaries<T extends RatedCleaner>(
  cleaners: readonly T[],
  sort: CleanerRatingSort,
): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const copy = [...cleaners];

  if (sort === "name") return copy.sort(byName);

  return copy.sort((a, b) => {
    if (a.averageRating === null || b.averageRating === null) {
      if (a.averageRating === b.averageRating) return byName(a, b);
      return a.averageRating === null ? 1 : -1;
    }
    return (
      a.averageRating - b.averageRating ||
      b.reviewCount - a.reviewCount ||
      byName(a, b)
    );
  });
}
