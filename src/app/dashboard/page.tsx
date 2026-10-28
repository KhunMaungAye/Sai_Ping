"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function DashboardRouter() {
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/auth/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { authenticated?: boolean; user?: { role: string } } | null) => {
        if (!data?.authenticated || !data.user) {
          router.replace("/login?redirect=/dashboard");
          return;
        }

        switch (data.user.role) {
          case "admin":
            router.replace("/dashboard/admin");
            break;
          case "cleaner":
            router.replace("/dashboard/cleaner");
            break;
          case "customer":
          default:
            router.replace("/bookings");
            break;
        }
      })
      .catch(() => {
        router.replace("/login?redirect=/dashboard");
      });

    return () => controller.abort();
  }, [router]);

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
        <p>Routing to your authorized dashboard…</p>
      </div>
    </main>
  );
}
