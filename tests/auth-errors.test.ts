import { describe, expect, it } from "vitest";

import { friendlyAuthError } from "@/lib/auth-errors";
import { emailSchema } from "@/lib/validation";

function firstIssue(value: string): string | undefined {
  const result = emailSchema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("emailSchema", () => {
  it("trims and accepts valid email addresses", () => {
    expect(emailSchema.parse("  ada@example.com  ")).toBe("ada@example.com");
  });

  it("reports missing and malformed emails with friendly messages", () => {
    expect(firstIssue("   ")).toBe("Enter your email address.");
    expect(firstIssue("not-an-email")).toBe("Enter a valid email address.");
    expect(firstIssue("ada@")).toBe("Enter a valid email address.");
  });
});

describe("friendlyAuthError", () => {
  it("strips better-call field prefixes from validation errors", () => {
    expect(
      friendlyAuthError(
        {
          code: "VALIDATION_ERROR",
          message: "[body.email] Invalid email address",
        },
        "Fallback",
      ),
    ).toBe("Enter a valid email address.");
  });

  it("maps known Better Auth error codes", () => {
    expect(
      friendlyAuthError(
        { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
        "Fallback",
      ),
    ).toBe("Email or password is incorrect.");
    expect(
      friendlyAuthError(
        { code: "USER_ALREADY_EXISTS", message: "User already exists." },
        "Fallback",
      ),
    ).toBe("An account with this email already exists. Try signing in instead.");
  });

  it("maps raw messages when no code is present", () => {
    expect(
      friendlyAuthError({ message: "[body.email] Invalid email" }, "Fallback"),
    ).toBe("Enter a valid email address.");
  });

  it("falls back for empty or missing errors", () => {
    expect(friendlyAuthError(null, "Fallback")).toBe("Fallback");
    expect(friendlyAuthError({ message: "   " }, "Fallback")).toBe("Fallback");
  });
});
