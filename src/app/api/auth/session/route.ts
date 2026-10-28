import { getAuthenticatedUser } from "../../../../lib/auth.ts";

export async function GET(request: Request) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    return Response.json(
      {
        authenticated: false,
        user: null,
        customer: null,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return Response.json(
    {
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      customer: user.role === "customer" ? { email: user.email } : null,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
