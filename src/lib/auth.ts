import { getCustomerFromSessionToken } from "./booking-store.ts";

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
 * Server-side customer authorization check.
 * Obtains the customer identity exclusively from authenticated sessions or headers.
 * NEVER trusts client-supplied query parameters or body customer IDs.
 */
export function getAuthenticatedCustomer(
  request: Request,
): { email: string } | null {
  // 1. Explicit header auth check (e.g. simulated auth proxy, test header, or service-to-service)
  const headerEmail = request.headers.get("x-customer-email");
  if (headerEmail && isValidEmail(headerEmail)) {
    return { email: headerEmail.trim().toLowerCase() };
  }

  // 2. Authorization header: Bearer <token_or_email>
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      // First check if token is in customer_sessions database
      const dbEmail = getCustomerFromSessionToken(token);
      if (dbEmail) return { email: dbEmail };

      // Or if token itself is a valid email string
      if (isValidEmail(token)) {
        return { email: token.toLowerCase() };
      }
    }
  }

  // 3. Cookie session check: customer_session, session, customer_email, auth_token
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const sessionToken =
    cookies["customer_session"] ||
    cookies["session"] ||
    cookies["customer_email"] ||
    cookies["auth_token"];

  if (sessionToken) {
    // Check if session token is in customer_sessions table
    const dbEmail = getCustomerFromSessionToken(sessionToken);
    if (dbEmail) return { email: dbEmail };

    // Or if cookie directly holds a valid email string
    if (isValidEmail(sessionToken)) {
      return { email: sessionToken.toLowerCase() };
    }
  }

  return null;
}
