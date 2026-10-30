import { cookies } from "next/headers";
import { makeSignature } from "better-auth/crypto";

import { auth } from "@/lib/auth";

/**
 * Create a Better Auth session after a checkout has been verified, then write
 * its signed session cookie. Sign-up never goes through Better Auth's public
 * endpoint, so this is the one place a new account becomes signed in.
 */
export async function establishSession(userId: string): Promise<void> {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId, false);
  if (!session) {
    throw new Error("Could not create the sign-in session.");
  }

  const signature = await makeSignature(session.token, context.secret);
  const cookie = context.authCookies.sessionToken;
  const sameSite =
    typeof cookie.attributes.sameSite === "string"
      ? (cookie.attributes.sameSite.toLowerCase() as
          | "lax"
          | "strict"
          | "none")
      : cookie.attributes.sameSite;
  (await cookies()).set(cookie.name, `${session.token}.${signature}`, {
    ...cookie.attributes,
    sameSite,
  });
}
