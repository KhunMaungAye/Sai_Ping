import { z } from "zod";
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
import { parseBody } from "../../../../lib/validation.ts";

const NO_STORE = { "Cache-Control": "no-store" };

const loginSchema = z.object({
  email: z
    .string()
    .catch("")
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, "Please enter your email address.")
        .refine(isValidEmail, "Please enter a valid email address."),
    )
    .transform((value) => value.toLowerCase()),
  password: z.string().catch("").pipe(z.string().min(1, "Please enter your password.")),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400, headers: NO_STORE });
  }

  if (typeof body !== "object" || body === null) {
    return Response.json(
      { error: "Email and password are required." },
      { status: 400, headers: NO_STORE },
    );
  }

  const reqObj = body as Record<string, unknown>;
  const redirectTarget = typeof reqObj.redirect === "string" ? reqObj.redirect : null;

  const parsed = parseBody(loginSchema, reqObj);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  }
  const { email, password } = parsed.data;

  const user = getUserByEmail(email);

  // Generic credential error to prevent account enumeration attacks
  if (!user) {
    return Response.json({ error: "Invalid email or password." }, { status: 401, headers: NO_STORE });
  }

  if (user.status === "suspended") {
    return Response.json(
      { error: "Your account has been suspended. Please contact support." },
      { status: 403, headers: NO_STORE },
    );
  }

  const isPasswordValid = await verifyPassword(password, user.password_hash);
  if (!isPasswordValid) {
    return Response.json({ error: "Invalid email or password." }, { status: 401, headers: NO_STORE });
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
    { status: 200, headers },
  );
}
