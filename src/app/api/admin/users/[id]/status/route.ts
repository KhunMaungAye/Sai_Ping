import { requireRole } from "../../../../../../lib/auth.ts";
import {
  getDatabase,
  getUserById,
  updateUserStatus,
  type UserStatus,
} from "../../../../../../lib/booking-store.ts";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const auth = requireRole(request, ["admin"]);
  if ("error" in auth) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { id } = await params;
  const user = getUserById(id);
  if (!user) {
    return Response.json(
      { error: "User not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Prevent admin from suspending themselves
  if (user.id === auth.user.id) {
    return Response.json(
      { error: "You cannot change your own account status." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const status =
    typeof body === "object" && body !== null && "status" in body
      ? (body as { status: unknown }).status
      : undefined;

  if (status !== "active" && status !== "suspended") {
    return Response.json(
      { error: "Status must be 'active' or 'suspended'." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    updateUserStatus(id, status as UserStatus);

    // If suspended, invalidate all active sessions immediately
    if (status === "suspended") {
      getDatabase()
        .prepare("DELETE FROM sessions WHERE user_id = ?")
        .run(id);
      getDatabase()
        .prepare("DELETE FROM customer_sessions WHERE email = ?")
        .run(user.email);
    }

    return Response.json(
      { success: true, user: { id: user.id, email: user.email, status } },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not update user status." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
