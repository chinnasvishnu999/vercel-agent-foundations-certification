import { cookies } from "next/headers";

import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "@/lib/admin-auth";

/**
 * Second layer of the admin gate for API routes (proxy.ts already redirects
 * unauthenticated /admin/* requests). Returns a 401 response, or null when
 * the request carries the admin session cookie.
 */
export async function requireAdmin(): Promise<Response | null> {
  const store = await cookies();
  if (store.get(ADMIN_COOKIE_NAME)?.value === ADMIN_PASSWORD) return null;
  return Response.json({ error: "Admin sign-in required." }, { status: 401 });
}
