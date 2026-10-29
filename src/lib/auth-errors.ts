type AuthErrorLike = {
  code?: string;
  message?: string;
};

const CODE_MESSAGES: Record<string, string> = {
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_EMAIL_OR_PASSWORD: "Email or password is incorrect.",
  INVALID_PASSWORD: "Password is incorrect.",
  PASSWORD_TOO_SHORT: "Password must be at least 8 characters.",
  PASSWORD_TOO_LONG: "Password must be 128 characters or fewer.",
  USER_ALREADY_EXISTS:
    "An account with this email already exists. Try signing in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Try signing in instead.",
  EMAIL_NOT_VERIFIED: "Verify your email before signing in.",
  INVALID_ORIGIN:
    "This request came from an untrusted origin. Reload the page and try again.",
};

const MESSAGE_ALIASES: Record<string, string> = {
  "invalid email": "Enter a valid email address.",
  "invalid email address": "Enter a valid email address.",
  "invalid email or password": "Email or password is incorrect.",
  "invalid password": "Password is incorrect.",
  "password too short": "Password must be at least 8 characters.",
  "password too long": "Password must be 128 characters or fewer.",
  "user already exists":
    "An account with this email already exists. Try signing in instead.",
  "user already exists.":
    "An account with this email already exists. Try signing in instead.",
  "user already exists. use another email.":
    "An account with this email already exists. Try signing in instead.",
  "email not verified": "Verify your email before signing in.",
};

/**
 * Converts Better Auth / better-call errors into messages suitable for the UI.
 * better-call prefixes raw validation messages with a field path, e.g.
 * `[body.email] Invalid email address`, which should never reach the user.
 */
export function friendlyAuthError(
  error: AuthErrorLike | null | undefined,
  fallback: string,
): string {
  if (!error) return fallback;

  const code = error.code?.trim().toUpperCase();
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  const message = error.message?.replace(/\[[^\]]+\]\s*/g, "").trim();
  if (!message) return fallback;

  const firstIssue = message.split(/;\s*/)[0]?.trim();
  if (!firstIssue) return fallback;

  return MESSAGE_ALIASES[firstIssue.toLowerCase()] ?? firstIssue;
}
