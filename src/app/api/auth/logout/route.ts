import { parseCookies } from "@/lib/auth";
import { deleteCustomerSession } from "@/lib/booking-store";

export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const token = cookies["customer_session"];

  if (token) {
    deleteCustomerSession(token);
  }

  return Response.json(
    { success: true },
    {
      status: 200,
      headers: {
        "Set-Cookie": `customer_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
        "Cache-Control": "no-store",
      },
    },
  );
}
