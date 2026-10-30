import {
  createUserSession,
  getUserByEmail,
} from "../../../../lib/booking-store.ts";
import {
  isValidEmail,
  sessionCookieHeaders,
  validateRedirect,
  verifyPassword,
} from "../../../../lib/auth.ts";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (typeof body !== "object" || body === null) {
    return Response.json(
      { error: "Email and password are required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const reqObj = body as Record<string, unknown>;
  const email =
    typeof reqObj.email === "string" ? reqObj.email.trim().toLowerCase() : "";
  const password =
    typeof reqObj.password === "string" ? reqObj.password : "";
  const redirectTarget =
    typeof reqObj.redirect === "string" ? reqObj.redirect : null;

  if (!email) {
    return Response.json(
      { error: "Please enter your email address." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isValidEmail(email)) {
    return Response.json(
      { error: "Please enter a valid email address." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!password) {
    return Response.json(
      { error: "Please enter your password." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const user = getUserByEmail(email);

  // Generic credential error to prevent account enumeration attacks
  if (!user) {
    return Response.json(
      { error: "Invalid email or password." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (user.status === "suspended") {
    return Response.json(
      { error: "Your account has been suspended. Please contact support." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const isPasswordValid = await verifyPassword(password, user.password_hash);
  if (!isPasswordValid) {
    return Response.json(
      { error: "Invalid email or password." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Create persistent session (7 days)
  const session = createUserSession(user.id, 7);
  const redirectUrl = validateRedirect(redirectTarget, user.role);

  const headers = sessionCookieHeaders(session.token, user.role);

  return Response.json(
    {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      redirectUrl,
    },
    {
      status: 200,
      headers,
    },
  );
}
