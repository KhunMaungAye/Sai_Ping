import { requireRole } from "../../../../lib/auth.ts";
import { listUsers } from "../../../../lib/booking-store.ts";

export async function GET(request: Request) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const users = listUsers();
    return Response.json(
      { users },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not retrieve user list." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
