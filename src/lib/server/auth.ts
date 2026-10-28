import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ApiError } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getLocalUser, isLocalMode } from "@/lib/server/desktop";

export type SessionUser = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>["user"];

export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  // Local mode is single-user and offline: resolve to the implicit local
  // account instead of a Better Auth session, so there is no sign-in/sign-up.
  if (isLocalMode()) return getLocalUser();
  const session = await getCurrentSession();
  return session?.user ?? null;
}

/** Server components and layouts: send anonymous visitors to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Route handlers: return a JSON 401 instead of redirecting. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError("Authentication required.", 401);
  return user;
}
