import { createCustomerSession } from "@/lib/booking-store";
import { isValidEmail } from "@/lib/auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email =
    typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";

  if (!isValidEmail(email)) {
    return Response.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const token = createCustomerSession(email);

  return Response.json(
    { success: true, email },
    {
      status: 200,
      headers: {
        "Set-Cookie": `customer_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
        "Cache-Control": "no-store",
      },
    },
  );
}
