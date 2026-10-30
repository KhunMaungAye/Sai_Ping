"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dashboardPathFor, useSession } from "@/lib/use-session";

/** Sends signed-in users to their role's dashboard and everyone else to /login. */
export default function RoleRouter({ loginRedirect }: { loginRedirect?: string }) {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.status === "ready") {
      router.replace(dashboardPathFor(session.user.role));
    } else if (session.status === "signed-out") {
      router.replace(
        loginRedirect
          ? `/login?redirect=${encodeURIComponent(loginRedirect)}`
          : "/login",
      );
    }
  }, [session.status, session.user, loginRedirect, router]);

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
      {session.status === "error" ? (
        <div className="dashboard-loading" role="alert">
          <p>We couldn&apos;t reach the server to check your sign-in.</p>
          <button type="button" className="inline-button" onClick={session.retry}>
            Try again
          </button>
        </div>
      ) : (
        <div className="dashboard-loading" role="status">
          <span className="dashboard-spinner" aria-hidden="true" />
          <p>Opening your dashboard…</p>
        </div>
      )}
    </main>
  );
}
