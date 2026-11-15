"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

export type AuthRole = "customer" | "cleaner";
export type AuthMode = "sign-in" | "sign-up";

const REMEMBER_KEY = "saiping:last-login";

const ROLE_LABELS: Record<AuthRole, string> = {
  customer: "Customer",
  cleaner: "Cleaner",
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

const ROLE_ICONS: Record<AuthRole, () => ReactNode> = {
  customer: CustomerIcon,
  cleaner: CleanerIcon,
};

/** US-18: only the email is remembered now — there's no sign-in role to restore. */
function readRememberedEmail(): string {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberEmail(email: string) {
  try {
    window.localStorage.setItem(REMEMBER_KEY, email);
  } catch {}
}

function forgetRememberedEmail() {
  try {
    window.localStorage.removeItem(REMEMBER_KEY);
  } catch {}
}

/**
 * Sign-in and sign-up form shared by the home page pop-up and /login.
 *
 * US-18: sign-in is a single form (email + password) — the server decides
 * the real account and role from `/api/auth/login`'s `redirectUrl`, so there
 * is nothing to pick here, not even for the one admin account. Only
 * Create account asks which kind of account, and only Customer/Cleaner are
 * offered (admin accounts can't be registered). Opening the panel with
 * `initialRole="cleaner"` — the "Become a cleaner" links — pre-selects
 * Cleaner on that tab; the default Create account entry point stays Customer.
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
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [rememberedEmail, setRememberedEmail] = useState("");
  // US-19: a cleaner's short application — a phone number, years of
  // experience, the areas they cover and a short note. No CV upload.
  const [phone, setPhone] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [areas, setAreas] = useState("");
  const [about, setAbout] = useState("");

  const isSignUp = mode === "sign-up";
  const isCleanerSignUp = isSignUp && role === "cleaner";

  // Returning visitors don't need to retype their email on sign-in (US-12).
  // A new account starts with an empty email, so the last user's address never carries over.
  useEffect(() => {
    const saved = readRememberedEmail();
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setRememberedEmail(saved);
    if (initialMode !== "sign-in") return;
    setEmail(saved);
  }, [initialMode]);

  const showingRememberedEmail = !isSignUp && rememberedEmail !== "" && email === rememberedEmail;

  function chooseRole(next: AuthRole) {
    setRole(next);
    setErrorMessage("");
  }

  function chooseMode(next: AuthMode) {
    setMode(next);
    // Create account never shows the remembered address; Sign in brings it back if the box is empty.
    if (next === "sign-up" && email === rememberedEmail) setEmail("");
    if (next === "sign-in" && !email && rememberedEmail) setEmail(rememberedEmail);
    setErrorMessage("");
  }

  function clearRememberedEmail() {
    forgetRememberedEmail();
    setRememberedEmail("");
    setEmail("");
    setErrorMessage("");
    document.getElementById(`${headingId}-email`)?.focus();
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
    if (isCleanerSignUp && !phone.trim()) {
      setErrorMessage("Please enter a phone number we can reach you on.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(isSignUp ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignUp
            ? {
                name: name.trim(),
                email: trimmedEmail,
                password,
                role,
                ...(isCleanerSignUp
                  ? {
                      phone: phone.trim(),
                      experienceYears: experienceYears.trim() || null,
                      areas: areas.trim() || null,
                      about: about.trim() || null,
                    }
                  : {}),
              }
            : { email: trimmedEmail, password, redirect },
        ),
      });
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        redirectUrl?: string;
        error?: string;
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

      // The server already decided the real account and role (US-18: sign-in
      // never declares one), so there's nothing to reconcile — just go.
      rememberEmail(trimmedEmail.toLowerCase());
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

  const subtitle = isSignUp
    ? role === "cleaner"
      ? "Pick the days you work and start accepting jobs near you."
      : "Book trusted Bangkok cleaners in under a minute."
    : "Sign in to your account.";

  return (
    <div className="auth-panel">
      <div className="auth-panel-head">
        <h2 id={headingId}>{title}</h2>
        <p>{subtitle}</p>
      </div>

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

      {isSignUp ? (
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
      ) : null}

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

        {isCleanerSignUp ? (
          <>
            <label className="auth-field">
              <span className="field-label">Phone number</span>
              <input
                type="tel"
                autoComplete="tel"
                className="text-input"
                placeholder="e.g. 081 234 5678"
                value={phone}
                maxLength={20}
                disabled={isLoading}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setErrorMessage("");
                }}
              />
            </label>

            <div className="cleaner-application-grid">
              <label className="auth-field">
                <span className="field-label">
                  Years of experience <span className="field-optional">(optional)</span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  className="text-input"
                  placeholder="e.g. 3"
                  value={experienceYears}
                  disabled={isLoading}
                  onChange={(e) => {
                    setExperienceYears(e.target.value);
                    setErrorMessage("");
                  }}
                />
              </label>
              <label className="auth-field">
                <span className="field-label">
                  Areas you cover <span className="field-optional">(optional)</span>
                </span>
                <input
                  type="text"
                  className="text-input"
                  placeholder="e.g. Sukhumvit, Silom"
                  value={areas}
                  maxLength={200}
                  disabled={isLoading}
                  onChange={(e) => {
                    setAreas(e.target.value);
                    setErrorMessage("");
                  }}
                />
              </label>
            </div>

            <label className="auth-field">
              <span className="field-label">
                Tell us about yourself <span className="field-optional">(optional)</span>
              </span>
              <textarea
                className="text-input"
                rows={3}
                maxLength={500}
                placeholder="Any cleaning experience, languages you speak, or anything else worth knowing."
                value={about}
                disabled={isLoading}
                onChange={(e) => {
                  setAbout(e.target.value);
                  setErrorMessage("");
                }}
              />
            </label>
          </>
        ) : null}

        <div className="auth-field">
          <div className="auth-field-row">
            <label className="field-label" htmlFor={`${headingId}-email`}>
              Email address
            </label>
            {showingRememberedEmail ? (
              <button type="button" className="show-hide-toggle" onClick={clearRememberedEmail}>
                Use another email
              </button>
            ) : null}
          </div>
          <input
            id={`${headingId}-email`}
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
        </div>

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
            "Sign in"
          )}
        </button>
      </form>
    </div>
  );
}
