import {
  createUserSession,
  registerAccount,
} from "../../../../lib/booking-store.ts";
import {
  getRoleDashboardPath,
  hashPassword,
  isValidEmail,
  passwordPolicyError,
  sessionCookieHeaders,
} from "../../../../lib/auth.ts";

const NO_STORE = { "Cache-Control": "no-store" };

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON request body.", 400);
  }

  if (typeof body !== "object" || body === null) {
    return fail("Name, email, password and account type are required.", 400);
  }

  const reqObj = body as Record<string, unknown>;
  const name = typeof reqObj.name === "string" ? reqObj.name.trim() : "";
  const email =
    typeof reqObj.email === "string" ? reqObj.email.trim().toLowerCase() : "";
  const password = typeof reqObj.password === "string" ? reqObj.password : "";
  const role = reqObj.role;

  if (role === "admin") {
    return fail("Admin accounts cannot be registered.", 403);
  }
  if (role !== "customer" && role !== "cleaner") {
    return fail("Choose whether you are signing up as a customer or a cleaner.", 400);
  }
  if (!name) {
    return fail("Please enter your name.", 400);
  }
  if (name.length > 80) {
    return fail("Name must be 80 characters or fewer.", 400);
  }
  if (!isValidEmail(email)) {
    return fail("Please enter a valid email address.", 400);
  }
  const passwordError = passwordPolicyError(password);
  if (passwordError) {
    return fail(passwordError, 400);
  }

  const result = registerAccount({
    name,
    email,
    role,
    passwordHash: await hashPassword(password),
  });

  if (result.status === "email-taken") {
    return fail("An account with this email already exists. Try signing in instead.", 409);
  }

  const { user } = result;
  const session = createUserSession(user.id, 7);

  return Response.json(
    {
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      redirectUrl: getRoleDashboardPath(user.role),
    },
    { status: 201, headers: sessionCookieHeaders(session.token, user.role) },
  );
}
