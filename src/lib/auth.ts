import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { getDb } from "@/db";
import * as schema from "@/db/schema";

const configuredSecret = process.env.BETTER_AUTH_SECRET?.trim();
const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

if (
  !configuredSecret &&
  process.env.NODE_ENV === "production" &&
  !isProductionBuild
) {
  throw new Error(
    "BETTER_AUTH_SECRET is required in production. Generate one with `openssl rand -base64 32` and set it in your deployment environment.",
  );
}

// `next build` evaluates route modules without deployment secrets. Use inert
// build-only values so the build stays quiet; the runtime guard above still
// refuses to run production without a real secret and public URL.
const secret =
  configuredSecret ||
  (isProductionBuild ? "masar-build-time-only-secret-placeholder" : undefined);
const baseURL =
  process.env.BETTER_AUTH_URL?.trim() ||
  (isProductionBuild ? "http://localhost:3000" : undefined);

export const auth = betterAuth({
  appName: "Masar",
  database: drizzleAdapter(getDb(), {
    provider: "sqlite",
    schema,
    usePlural: true,
  }),
  secret,
  baseURL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  plugins: [nextCookies()],
});
