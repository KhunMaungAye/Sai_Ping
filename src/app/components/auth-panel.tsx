"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

export type AuthRole = "customer" | "cleaner" | "admin";
export type AuthMode = "sign-in" | "sign-up";

const REMEMBER_KEY = "saiping:last-login";

const ROLE_LABELS: Record<AuthRole, string> = {
  customer: "Customer",
  cleaner: "Cleaner",
  admin: "Admin",
};

function CustomerIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 22 24 9l16 13" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 19v19h22V19" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
      <path d="M21 38v-9h6v9" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
      <path d="m37 6 1.4 3.1L41.5 10.5 38.4 12 37 15l-1.4-3-3.1-1.5 3.1-1.4Z" fill="var(--sunny)" />
    </svg>
  );
}

function CleanerIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M17 8h10v6H17z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M27 10h6l3 3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 20c0-3 2-6 4-6h6c2 0 4 3 4 6v18a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M19 27h6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="39" cy="19" r="1.8" fill="currentColor" />
      <circle cx="42" cy="24" r="1.4" fill="currentColor" />
      <path d="m38 30 1.2 2.6 2.6 1.2-2.6 1.2L38 37.6l-1.2-2.6-2.6-1.2 2.6-1.2Z" fill="var(--sunny)" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 6 39 12v11c0 9.5-6.3 16.6-15 19-8.7-2.4-15-9.5-15-19V12Z" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
      <path d="m17 24 5 5 9-10" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ROLE_ICONS: Record<AuthRole, () => ReactNode> = {
  customer: CustomerIcon,
  cleaner: CleanerIcon,
  admin: AdminIcon,
};

function readRemembered(): { email: string; role: AuthRole } | null {
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: unknown; role?: unknown };
    if (
      typeof parsed.email === "string" &&
      (parsed.role === "customer" || parsed.role === "cleaner" || parsed.role === "admin")
    ) {
      return { email: parsed.email, role: parsed.role };
    }
  } catch {}
  return null;
}

function remember(email: string, role: AuthRole) {
  try {
    window.localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email, role }));
  } catch {}
}

/**
 * Sign-in and sign-up form shared by the home page pop-up and /login.
 * The role tiles only steer the form; the server decides the real role.
 */
export function AuthPanel({
  initialRole,
  initialMode = "sign-in",
  redirect = null,
  headingId = "auth-title",
}: {
  initialRole?: AuthRole;
  initialMode?: AuthMode;
  redirect?: string | null;
  headingId?: string;
}) {
  const [role, setRole] = useState<AuthRole>(initialRole ?? "customer");
  const [mode, setMode] = useState<AuthMode>(
    initialRole === "admin" ? "sign-in" : initialMode,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Returning visitors don't need to retype their email (US-12)
  useEffect(() => {
    const saved = readRemembered();
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setEmail(saved.email);
    if (!initialRole && initialMode === "sign-in") setRole(saved.role);
  }, [initialRole, initialMode]);

  const isSignUp = mode === "sign-up" && role !== "admin";

  function chooseRole(next: AuthRole) {
    setRole(next);
    if (next === "admin") setMode("sign-in");
    setErrorMessage("");
  }

  function chooseMode(next: AuthMode) {
    setMode(next);
    setErrorMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const trimmedEmail = email.trim();
    if (isSignUp && !name.trim()) {
      setErrorMessage("Please enter your name.");
      return;
    }
    if (!trimmedEmail) {
      setErrorMessage("Please enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setErrorMessage("Please enter your password.");
      return;
    }
    if (isSignUp && password !== confirmPassword) {
      setErrorMessage("The two passwords don't match.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(isSignUp ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignUp
            ? { name: name.trim(), email: trimmedEmail, password, role }
            : { email: trimmedEmail, password, redirect },
        ),
      });
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        redirectUrl?: string;
        error?: string;
        user?: { role?: AuthRole };
      } | null;

      if (!res.ok || !data?.success) {
        setPassword("");
        setConfirmPassword("");
        setErrorMessage(
          data?.error ||
            (isSignUp
              ? "We couldn't create your account. Please try again."
              : "Invalid email or password. Please try again."),
        );
        setIsLoading(false);
        return;
      }

      const actualRole = data.user?.role ?? role;
      if (!isSignUp && actualRole !== role) {
        // Signed in, but with a different account type than the tile chosen:
        // sign straight back out and point the user at the right tile.
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        setPassword("");
        setRole(actualRole);
        setErrorMessage(
          `This is a ${ROLE_LABELS[actualRole].toLowerCase()} account. We've switched to ${ROLE_LABELS[actualRole]} — sign in again.`,
        );
        setIsLoading(false);
        return;
      }

      remember(trimmedEmail.toLowerCase(), actualRole);
      window.location.href = data.redirectUrl || "/dashboard";
    } catch {
      setPassword("");
      setConfirmPassword("");
      setErrorMessage(
        "Could not reach the server. Please check your connection and try again.",
      );
      setIsLoading(false);
    }
  }

  const title = isSignUp
    ? role === "cleaner"
      ? "Join our cleaning team"
      : "Create your account"
    : "Welcome back";

  return (
    <div className="auth-panel">
      <div className="auth-panel-head">
        <h2 id={headingId}>{title}</h2>
        <p>
          {isSignUp
            ? role === "cleaner"
              ? "Pick the days you work and start accepting jobs near you."
              : "Book trusted Bangkok cleaners in under a minute."
            : "Choose your account type and sign in."}
        </p>
      </div>

      <div className="role-tiles" role="radiogroup" aria-label="Account type">
        {(Object.keys(ROLE_LABELS) as AuthRole[]).map((key) => {
          const Icon = ROLE_ICONS[key];
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={role === key}
              aria-label={ROLE_LABELS[key]}
              className={`role-tile${role === key ? " is-active" : ""}`}
              onClick={() => chooseRole(key)}
              disabled={isLoading}
            >
              <span className="role-tile-icon">
                <Icon />
              </span>
              <span className="role-tile-label">{ROLE_LABELS[key]}</span>
            </button>
          );
        })}
      </div>

      {role === "admin" ? (
        <p className="auth-admin-note">Admin sign-in only — there is one administrator account.</p>
      ) : (
        <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
          <button
            type="button"
            role="tab"
            aria-selected={!isSignUp}
            className={`auth-tab${!isSignUp ? " is-active" : ""}`}
            onClick={() => chooseMode("sign-in")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignUp}
            className={`auth-tab${isSignUp ? " is-active" : ""}`}
            onClick={() => chooseMode("sign-up")}
          >
            Create account
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="auth-panel-form" noValidate>
        {isSignUp ? (
          <label className="auth-field">
            <span className="field-label">Full name</span>
            <input
              type="text"
              autoComplete="name"
              className="text-input"
              placeholder="e.g. Somchai Jaidee"
              value={name}
              maxLength={80}
              disabled={isLoading}
              onChange={(e) => {
                setName(e.target.value);
                setErrorMessage("");
              }}
            />
          </label>
        ) : null}

        <label className="auth-field">
          <span className="field-label">Email address</span>
          <input
            type="email"
            autoComplete="email"
            className="text-input"
            placeholder="you@example.com"
            value={email}
            disabled={isLoading}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrorMessage("");
            }}
          />
        </label>

        <div className="auth-field">
          <div className="auth-field-row">
            <label className="field-label" htmlFor={`${headingId}-password`}>
              Password
            </label>
            <button
              type="button"
              className="show-hide-toggle"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <input
            id={`${headingId}-password`}
            type={showPassword ? "text" : "password"}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            className="text-input"
            placeholder={isSignUp ? "At least 8 characters, with a number" : "Enter your password"}
            value={password}
            disabled={isLoading}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrorMessage("");
            }}
          />
        </div>

        {isSignUp ? (
          <label className="auth-field">
            <span className="field-label">Confirm password</span>
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              className="text-input"
              placeholder="Type it once more"
              value={confirmPassword}
              disabled={isLoading}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrorMessage("");
              }}
            />
          </label>
        ) : null}

        {errorMessage ? (
          <div className="form-error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <button
          type="submit"
          className="sunny-button auth-panel-submit"
          disabled={isLoading || !email.trim() || !password}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <span className="btn-loading-wrap">
              <span className="btn-spinner" aria-hidden="true" />
              <span>{isSignUp ? "Creating account…" : "Signing in…"}</span>
            </span>
          ) : isSignUp ? (
            `Create ${ROLE_LABELS[role].toLowerCase()} account`
          ) : (
            `Sign in as ${ROLE_LABELS[role]}`
          )}
        </button>
      </form>
    </div>
  );
}
