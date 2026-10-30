"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function UnauthorizedPage() {
  const router = useRouter();

  async function handleSwitchAccount() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    router.replace("/login");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/dashboard" aria-label="Sai Ping home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Sai Ping</span>
        </Link>
        <span className="topbar-note">A little more room to breathe.</span>
        <div className="topbar-nav">
          <Link className="topbar-link" href="/dashboard">
            Dashboard
          </Link>
        </div>
      </header>

      <div className="login-page-container">
        <section className="login-card" style={{ textAlign: "center" }} aria-labelledby="unauth-title">
          <span className="auth-icon" style={{ background: "#fdf0ed", color: "var(--coral)" }} aria-hidden="true">
            🚫
          </span>
          <p className="eyebrow" style={{ color: "var(--coral)" }}>403 FORBIDDEN</p>
          <h1 id="unauth-title" style={{ margin: "8px 0 12px" }}>Access Restricted</h1>
          <p className="auth-description">
            Your authenticated user role does not have permission to access the requested page or operation.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "24px" }}>
            <Link href="/dashboard" className="confirm-button" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
              Go to my role dashboard
            </Link>

            <button
              type="button"
              className="inline-button"
              onClick={handleSwitchAccount}
              style={{ marginTop: "8px", color: "var(--muted)" }}
            >
              Sign out and switch account
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
