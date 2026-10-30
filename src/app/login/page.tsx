"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dashboardPathFor, useSession } from "@/lib/use-session";
import { AuthPanel } from "../components/auth-panel";
import { BrandLogo } from "../components/brand-logo";

export default function LoginPage() {
  const router = useRouter();
  const session = useSession();
  const [redirect, setRedirect] = useState<string | null>(null);
  const checkingSession =
    session.status === "loading" || session.status === "ready";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the query string is only readable after mount
    setRedirect(new URLSearchParams(window.location.search).get("redirect"));
  }, []);

  // If user is already authenticated, redirect them to their dashboard
  useEffect(() => {
    if (session.status === "ready") {
      router.replace(dashboardPathFor(session.user.role));
    }
  }, [session.status, session.user, router]);

  return (
    <main className="login-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <BrandLogo />
          <Link className="site-link" href="/">
            ← Back to home
          </Link>
        </div>
      </header>

      <div className="login-stage">
        <div className="login-stage-copy">
          <p className="eyebrow-light">Secure portal access</p>
          <h1>Your sparkling home starts here.</h1>
          <p>
            Customers book and review cleanings, cleaners pick up jobs on the
            days they work, and our admin keeps everything running smoothly.
          </p>
        </div>
        <section className="auth-card" aria-labelledby="login-title">
          {checkingSession ? (
            <div className="dashboard-loading" role="status">
              <span className="dashboard-spinner" aria-hidden="true" />
              <p>Checking authentication…</p>
            </div>
          ) : (
            <AuthPanel redirect={redirect} headingId="login-title" />
          )}
        </section>
      </div>
    </main>
  );
}
