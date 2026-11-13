"use client";

import { REVIEW_TAGS, type ReviewTag } from "@/lib/review-tags";

/** US-16: tag pills on the rating form ("Punctual", "Detailed", …). Each one toggles on and off. */
export function ReviewTagPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ReviewTag[];
  onChange: (tags: ReviewTag[]) => void;
  disabled?: boolean;
}) {
  function toggle(tag: ReviewTag) {
    const next = value.includes(tag) ? value.filter((item) => item !== tag) : [...value, tag];
    // Keep the same order as REVIEW_TAGS so saved tags always read the same way.
    onChange(REVIEW_TAGS.filter((item) => next.includes(item)));
  }

  return (
    <div className="review-tag-picker" role="group" aria-label="Feedback tags (optional)">
      {REVIEW_TAGS.map((tag) => {
        const selected = value.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            className={`review-tag-pill${selected ? " is-selected" : ""}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => toggle(tag)}
          >
            {selected ? "✓ " : ""}
            {tag}
          </button>
        );
      })}
    </div>
  );
}

/** US-16: the tags saved on a rating, shown as small read-only chips. */
export function ReviewTagList({ tags }: { tags: readonly string[] }) {
  if (!tags.length) return null;
  return (
    <ul className="review-tag-list" aria-label="Feedback tags">
      {tags.map((tag) => (
        <li key={tag} className="review-tag-chip">
          {tag}
        </li>
      ))}
    </ul>
  );
}
