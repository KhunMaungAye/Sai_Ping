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

  // US-19: a cleaner's short application — a phone number, how many years of
  // experience, the areas they cover and a short note. No CV upload.
  let application: { phone: string; experienceYears: number | null; areas: string | null; about: string | null } | undefined;
  if (role === "cleaner") {
    const phone = typeof reqObj.phone === "string" ? reqObj.phone.trim() : "";
    if (!phone) {
      return fail("Please enter a phone number we can reach you on.", 400);
    }
    if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) {
      return fail("Please enter a valid phone number.", 400);
    }

    let experienceYears: number | null = null;
    if (reqObj.experienceYears !== undefined && reqObj.experienceYears !== null && reqObj.experienceYears !== "") {
      const parsed = Number(reqObj.experienceYears);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60) {
        return fail("Years of experience must be a whole number from 0 to 60.", 400);
      }
      experienceYears = parsed;
    }

    const areas = typeof reqObj.areas === "string" ? reqObj.areas.trim().slice(0, 200) : "";
    const about = typeof reqObj.about === "string" ? reqObj.about.trim().slice(0, 500) : "";

    application = {
      phone,
      experienceYears,
      areas: areas || null,
      about: about || null,
    };
  }

  const result = registerAccount({
    name,
    email,
    role,
    passwordHash: await hashPassword(password),
    application,
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
