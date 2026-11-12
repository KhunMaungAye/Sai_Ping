import bcrypt from "bcryptjs";
import {
  getSession,
  getUserById,
  type User,
  type UserRole,
} from "./booking-store.ts";

export function isValidEmail(val: unknown): val is string {
  if (typeof val !== "string") return false;
  const trimmed = val.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && trimmed.length <= 254;
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key) {
        try {
          cookies[key] = decodeURIComponent(val);
        } catch {
          cookies[key] = val;
        }
      }
    }
  }
  return cookies;
}

/**
 * Hash a plain password using bcrypt with salt rounds = 10.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Verify a plain password against stored bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * Helper to extract session token from incoming request headers and cookies.
 */
export function extractSessionToken(request: Request): string | null {
  // 1. Authorization header: Bearer <token>
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  // 2. Custom header (e.g. testing)
  const headerToken = request.headers.get("x-session-token");
  if (headerToken && headerToken.trim()) {
    return headerToken.trim();
  }

  // 3. Cookies: session_token, customer_session, session, auth_token
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  return (
    cookies["session_token"] ||
    cookies["customer_session"] ||
    cookies["session"] ||
    cookies["auth_token"] ||
    null
  );
}

/**
 * Server-side user authorization check.
 * Identity comes ONLY from a real, unexpired session token (Bearer header,
 * `x-session-token` header, or a session cookie) that maps to an existing,
 * active user row. A bare email is never accepted as identity, and the role is
 * always read from the database, never from the client.
 */
export function getAuthenticatedUser(request: Request): User | null {
  const token = extractSessionToken(request);
  if (!token) return null;

  const session = getSession(token);
  if (!session) return null;

  // Only the account the session was issued to. Never look it up by email: a
  // new account registered later with the same email must not inherit it.
  const user = getUserById(session.userId);
  if (!user || user.status === "suspended") return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    cleanerId: user.cleanerId,
    status: user.status,
    createdAt: user.createdAt,
  };
}

/**
 * Enforces role-based access control.
 * Rejects unauthenticated requests with 401 and unauthorized requests with 403.
 */
export function requireRole(
  request: Request,
  allowedRoles: UserRole[],
): { user: User } | { error: string; status: number } {
  const user = getAuthenticatedUser(request);
  if (!user) {
    return { error: "Unauthorized. Please sign in.", status: 401 };
  }

  if (!allowedRoles.includes(user.role)) {
    return {
      error: `Forbidden. Access requires ${allowedRoles.join(" or ")} role.`,
      status: 403,
    };
  }

  return { user };
}

/**
 * Kept for the US-05 cancel route. `requireRole` now accepts only real session
 * tokens too, so this is the same check.
 */
export const requireSessionRole = requireRole;

/**
 * Returns role-specific default dashboard destination.
 */
export function getRoleDashboardPath(role: UserRole): string {
  switch (role) {
    case "customer":
      return "/bookings";
    case "cleaner":
      return "/dashboard/cleaner";
    case "admin":
      return "/dashboard/admin";
    default:
      return "/bookings";
  }
}

/**
 * Validates a redirect destination to prevent open redirects and ensure
 * the authenticated user's role is authorized to access it.
 */
export function validateRedirect(
  destination: string | null | undefined,
  role: UserRole,
): string {
  const fallback = getRoleDashboardPath(role);
  if (!destination || typeof destination !== "string") {
    return fallback;
  }

  const trimmed = destination.trim();
  // Disallow external URLs or protocol-relative URLs (e.g., //evil.com or http://...)
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("://") || trimmed.startsWith("/\\")) {
    return fallback;
  }

  // Prevent routing to role-restricted destinations if user role does not match
  if (trimmed.startsWith("/dashboard/admin") && role !== "admin") {
    return fallback;
  }
  if (trimmed.startsWith("/dashboard/cleaner") && role !== "cleaner") {
    return fallback;
  }
  if (trimmed.startsWith("/bookings") && role !== "customer") {
    return fallback;
  }
  if (trimmed === "/dashboard") {
    return fallback;
  }

  return trimmed;
}

/**
 * Response headers that sign the user in: the `session_token` cookie (plus the
 * legacy `customer_session` cookie for customers) with a 7-day lifetime.
 */
export function sessionCookieHeaders(token: string, role: UserRole): Headers {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  const attributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secureFlag}`;
  const headers = new Headers();
  headers.append("Set-Cookie", `session_token=${encodeURIComponent(token)}; ${attributes}`);
  if (role === "customer") {
    headers.append("Set-Cookie", `customer_session=${encodeURIComponent(token)}; ${attributes}`);
  }
  headers.set("Cache-Control", "no-store");
  return headers;
}

/**
 * Password policy for self-registered accounts. Returns an error message, or
 * null when the password is acceptable.
 */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 128) return "Password must be 128 characters or fewer.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}
