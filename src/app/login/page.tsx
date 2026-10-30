"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dashboardPathFor, useSession } from "@/lib/use-session";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const session = useSession();
  const checkingSession =
    session.status === "loading" || session.status === "ready";

  // If user is already authenticated, redirect them to their dashboard
  useEffect(() => {
    if (session.status === "ready") {
      router.replace(dashboardPathFor(session.user.role));
    }
  }, [session.status, session.user, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const trimmedEmail = email.trim();
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

    setIsLoading(true);

    // Get any redirect query parameter from current URL
    let redirectParam: string | null = null;
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      redirectParam = urlParams.get("redirect");
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          redirect: redirectParam,
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        redirectUrl?: string;
        error?: string;
      } | null;

      if (!res.ok || !data?.success) {
        // Preserve user's email, but clear password
        setPassword("");
        setErrorMessage(
          data?.error || "Invalid email or password. Please try again.",
        );
        setIsLoading(false);
        return;
      }

      // Navigate to destination returned by server
      const destination = data.redirectUrl || "/dashboard";
      window.location.href = destination;
    } catch {
      setPassword("");
      setErrorMessage(
        "Could not connect to the authentication server. Please check your network and try again.",
      );
      setIsLoading(false);
    }
  }

  function fillDevAccount(devEmail: string, devPass: string) {
    setEmail(devEmail);
    setPassword(devPass);
    setErrorMessage("");
  }

  if (checkingSession) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Sai Ping home">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <span>Sai Ping</span>
          </Link>
        </header>
        <div className="dashboard-loading" role="status">
          <span className="dashboard-spinner" aria-hidden="true" />
          <p>Checking authentication…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Sai Ping home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Sai Ping</span>
        </Link>
        <span className="topbar-note">A little more room to breathe.</span>
        <div className="topbar-nav">
          <Link className="topbar-link" href="/">
            Book a cleaning
          </Link>
        </div>
      </header>

      <div className="login-page-container">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-card-header">
            <span className="auth-icon" aria-hidden="true">
              🔐
            </span>
            <p className="eyebrow">SECURE PORTAL ACCESS</p>
            <h1 id="login-title">Welcome Back</h1>
            <p className="auth-description">
              Sign in to securely access your role-specific dashboard (Customer,
              Cleaner, or Administrator).
            </p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <div className="form-group">
              <label className="field-label" htmlFor="login-email">
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                className="text-input"
                placeholder="name@saiping.com"
                value={email}
                required
                disabled={isLoading}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrorMessage("");
                }}
              />
            </div>

            <div className="form-group" style={{ marginTop: "16px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <label className="field-label" htmlFor="login-password">
                  Password
                </label>
                <button
                  type="button"
                  className="show-hide-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={0}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <div className="password-input-wrap">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="text-input password-input"
                  placeholder="Enter your password"
                  value={password}
                  required
                  disabled={isLoading}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMessage("");
                  }}
                />
              </div>
            </div>

            {errorMessage ? (
              <div
                className="form-error"
                role="alert"
                style={{ marginTop: "16px" }}
              >
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              className="confirm-button auth-submit-btn"
              disabled={isLoading || !email.trim() || !password}
              aria-busy={isLoading}
            >
              {isLoading ? (
                <span className="btn-loading-wrap">
                  <span className="btn-spinner" aria-hidden="true" />
                  <span>Signing in…</span>
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          {/* Quick Development Test Account Fillers */}
          <div className="dev-accounts-box">
            <span className="dev-accounts-title">Quick Dev Test Logins:</span>
            <div className="dev-account-buttons">
              <button
                type="button"
                className="dev-account-btn"
                onClick={() =>
                  fillDevAccount("customer@saiping.com", "CustomerPassword123!")
                }
              >
                👤 Customer
              </button>
              <button
                type="button"
                className="dev-account-btn"
                onClick={() =>
                  fillDevAccount("cleaner@saiping.com", "CleanerPassword123!")
                }
              >
                🧹 Cleaner
              </button>
              <button
                type="button"
                className="dev-account-btn"
                onClick={() =>
                  fillDevAccount("cleaner2@saiping.com", "Cleaner2Password123!")
                }
              >
                🧽 Cleaner 2
              </button>
              <button
                type="button"
                className="dev-account-btn"
                onClick={() =>
                  fillDevAccount("admin@saiping.com", "AdminPassword123!")
                }
              >
                ⚙️ Admin
              </button>
            </div>
          </div>

          <div className="auth-hint">
            <span>Customer, cleaner, or administrator?</span>{" "}
            <span style={{ color: "var(--muted)", fontSize: "13px" }}>
              Sign in above to access your role-specific portal.
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
