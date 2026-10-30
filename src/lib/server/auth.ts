import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ApiError } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getEntitlementForUser } from "@/lib/billing/subscriptions";
import type { SubscriptionEntitlement } from "@/lib/billing/entitlement";
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

export async function getOnlineAccess(): Promise<SubscriptionEntitlement> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      entitled: false,
      reason: "none",
      status: null,
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
    };
  }
  if (isLocalMode()) {
    return {
      entitled: true,
      reason: "active",
      status: "local",
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
    };
  }
  return getEntitlementForUser(user.id);
}

/** Server components and layouts: auth + active subscription/trial. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // The desktop local workspace is free and offline; billing never applies.
  if (isLocalMode()) return user;

  const entitlement = await getEntitlementForUser(user.id);
  if (!entitlement.entitled) redirect("/subscription?required=1");
  return user;
}

/** Route handlers: auth + active subscription/trial, returning 401/402 JSON. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await requireApiAuthUser();
  if (isLocalMode()) return user;

  const entitlement = await getEntitlementForUser(user.id);
  if (!entitlement.entitled) {
    throw new ApiError(
      "An active Masar subscription or trial is required.",
      402,
    );
  }
  return user;
}

/**
 * Auth-only helpers for billing pages and routes. Expired accounts must still
 * be able to manage their subscription and sign out.
 */
export async function requireAuthUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireApiAuthUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError("Authentication required.", 401);
  return user;
}
