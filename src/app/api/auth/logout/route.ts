import { extractSessionToken } from "../../../../lib/auth.ts";
import { deleteSession } from "../../../../lib/booking-store.ts";

export async function POST(request: Request) {
  const token = extractSessionToken(request);

  if (token) {
    deleteSession(token);
  }

  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";

  const clearSessionToken = `session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`;
  const clearCustomerSession = `customer_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`;

  const headers = new Headers();
  headers.append("Set-Cookie", clearSessionToken);
  headers.append("Set-Cookie", clearCustomerSession);
  headers.set("Cache-Control", "no-store");

  return Response.json(
    { success: true, message: "Signed out successfully." },
    {
      status: 200,
      headers,
    },
  );
}
