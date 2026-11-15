import { z } from "zod";
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
import { parseBody } from "../../../../lib/validation.ts";

const NO_STORE = { "Cache-Control": "no-store" };

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

const PHONE_PATTERN = /^[0-9+\-\s()]{7,20}$/;

/**
 * The cleaner-application fields are only required when role is "cleaner",
 * and the checks must stop at the first problem (matching every other route
 * in this app, and what the sign-up form shows one error at a time). A
 * single superRefine, rather than separate field schemas, is what keeps that
 * exact priority order — admin accounts get their own 403 before this ever
 * runs, since that's not a validation error at all.
 */
const registerSchema = z
  .object({
    name: z.unknown().optional(),
    email: z.unknown().optional(),
    password: z.unknown().optional(),
    role: z.unknown().optional(),
    phone: z.unknown().optional(),
    experienceYears: z.unknown().optional(),
    areas: z.unknown().optional(),
    about: z.unknown().optional(),
  })
  .transform((raw, ctx) => {
    if (raw.role !== "customer" && raw.role !== "cleaner") {
      ctx.addIssue({
        code: "custom",
        message: "Choose whether you are signing up as a customer or a cleaner.",
      });
      return z.NEVER;
    }
    const role: "customer" | "cleaner" = raw.role;

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) {
      ctx.addIssue({ code: "custom", message: "Please enter your name." });
      return z.NEVER;
    }
    if (name.length > 80) {
      ctx.addIssue({ code: "custom", message: "Name must be 80 characters or fewer." });
      return z.NEVER;
    }

    const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) {
      ctx.addIssue({ code: "custom", message: "Please enter a valid email address." });
      return z.NEVER;
    }

    const password = typeof raw.password === "string" ? raw.password : "";
    const passwordError = passwordPolicyError(password);
    if (passwordError) {
      ctx.addIssue({ code: "custom", message: passwordError });
      return z.NEVER;
    }

    if (role !== "cleaner") {
      return { name, email, password, role, application: undefined as
        | { phone: string; experienceYears: number | null; areas: string | null; about: string | null }
        | undefined };
    }

    // US-19: a cleaner's short application — a phone number, how many years
    // of experience, the areas they cover and a short note. No CV upload.
    const phone = typeof raw.phone === "string" ? raw.phone.trim() : "";
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Please enter a phone number we can reach you on." });
      return z.NEVER;
    }
    if (!PHONE_PATTERN.test(phone)) {
      ctx.addIssue({ code: "custom", message: "Please enter a valid phone number." });
      return z.NEVER;
    }

    let experienceYears: number | null = null;
    if (raw.experienceYears !== undefined && raw.experienceYears !== null && raw.experienceYears !== "") {
      const parsed = Number(raw.experienceYears);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60) {
        ctx.addIssue({
          code: "custom",
          message: "Years of experience must be a whole number from 0 to 60.",
        });
        return z.NEVER;
      }
      experienceYears = parsed;
    }

    const areas = typeof raw.areas === "string" ? raw.areas.trim().slice(0, 200) : "";
    const about = typeof raw.about === "string" ? raw.about.trim().slice(0, 500) : "";

    return {
      name,
      email,
      password,
      role,
      application: { phone, experienceYears, areas: areas || null, about: about || null },
    };
  });

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

  // Checked before validation: being an admin account isn't a bad request,
  // it's simply not allowed, so it gets its own 403 rather than a 400.
  if (reqObj.role === "admin") {
    return fail("Admin accounts cannot be registered.", 403);
  }

  const parsed = parseBody(registerSchema, reqObj);
  if (!parsed.ok) {
    return fail(parsed.error, 400);
  }
  const { name, email, password, role, application } = parsed.data;

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
