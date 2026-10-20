import { getAuthenticatedCustomer } from "@/lib/auth";

export async function GET(request: Request) {
  const customer = getAuthenticatedCustomer(request);
  if (!customer) {
    return Response.json(
      { authenticated: false, customer: null },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { authenticated: true, customer: { email: customer.email } },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
