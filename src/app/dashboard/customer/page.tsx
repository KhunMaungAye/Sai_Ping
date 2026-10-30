"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CustomerDashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/bookings");
  }, [router]);

  return (
    <main className="app-shell">
      <div className="dashboard-loading" role="status">
        <span className="dashboard-spinner" aria-hidden="true" />
        <p>Loading customer portal…</p>
      </div>
    </main>
  );
}
