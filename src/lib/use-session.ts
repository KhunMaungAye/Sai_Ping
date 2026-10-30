"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "./booking-store";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export type SessionState =
  | { status: "loading"; user: null }
  | { status: "ready"; user: SessionUser }
  | { status: "signed-out"; user: null }
  | { status: "error"; user: null };

export function dashboardPathFor(role: UserRole) {
  switch (role) {
    case "admin":
      return "/dashboard/admin";
    case "cleaner":
      return "/dashboard/cleaner";
    default:
      return "/bookings";
  }
}

/**
 * Loads the current session once and, when `allowedRoles` is given, sends the
 * visitor to /login or /unauthorized as needed.
 *
 * React runs effects twice in development, which aborts the first request.
 * That abort must never be treated as "signed out": doing so bounced users
 * between /login and their dashboard in an endless loop.
 */
export function useSession(options: {
  allowedRoles?: UserRole[];
  loginRedirect?: string;
} = {}) {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({
    status: "loading",
    user: null,
  });
  const [attempt, setAttempt] = useState(0);
  const allowedKey = options.allowedRoles?.join(",") ?? "";
  const loginRedirect = options.loginRedirect;

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Session check failed (${res.status})`);
        return (await res.json()) as {
          authenticated?: boolean;
          user?: SessionUser | null;
        };
      })
      .then((data) => {
        if (controller.signal.aborted) return;

        if (!data.authenticated || !data.user) {
          setState({ status: "signed-out", user: null });
          if (allowedKey) {
            const target = loginRedirect
              ? `/login?redirect=${encodeURIComponent(loginRedirect)}`
              : "/login";
            router.replace(target);
          }
          return;
        }

        if (allowedKey && !allowedKey.split(",").includes(data.user.role)) {
          router.replace("/unauthorized");
          return;
        }

        setState({ status: "ready", user: data.user });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ status: "error", user: null });
      });

    return () => controller.abort();
  }, [allowedKey, loginRedirect, router, attempt]);

  return {
    ...state,
    retry: () => {
      setState({ status: "loading", user: null });
      setAttempt((value) => value + 1);
    },
  };
}

export async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Cookies are cleared server-side; navigate away regardless.
  }
  window.location.replace("/login");
}
