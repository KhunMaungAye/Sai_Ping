"use client";

import { useEffect, useRef } from "react";
import { AuthPanel, type AuthMode, type AuthRole } from "./auth-panel";

/** Accessible pop-up wrapper around AuthPanel used on the home page. */
export function AuthModal({
  open,
  initialRole,
  initialMode,
  onClose,
}: {
  open: boolean;
  initialRole?: AuthRole;
  initialMode?: AuthMode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (dialog?.querySelector<HTMLElement>("input") ?? focusables()[0])?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="auth-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <button type="button" className="auth-modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <AuthPanel
          // Remount so each opening starts from the requested role and tab
          key={`${initialRole ?? "any"}-${initialMode ?? "sign-in"}`}
          initialRole={initialRole}
          initialMode={initialMode}
          headingId="auth-modal-title"
        />
      </div>
    </div>
  );
}
