import { describe, expect, it } from "vitest";

import {
  cleanError,
  userFacingErrorMessage,
} from "../desktop/src/user-facing-error";

describe("userFacingErrorMessage", () => {
  it("removes the Electron IPC wrapper and PremiumApiError name", () => {
    const error = new Error(
      "Error invoking remote method 'masar:premium-login': PremiumApiError: Email or password is incorrect.",
    );

    expect(userFacingErrorMessage(error)).toBe(
      "Email or password is incorrect.",
    );
  });

  it("removes nested technical prefixes", () => {
    expect(
      userFacingErrorMessage(
        new Error("Error: PremiumApiError: Email or password is incorrect."),
      ),
    ).toBe("Email or password is incorrect.");
  });

  it("leaves user-facing messages unchanged", () => {
    expect(
      userFacingErrorMessage(new Error("Email or password is incorrect.")),
    ).toBe("Email or password is incorrect.");
  });

  it("keeps the original error available as the cause", () => {
    const original = new Error(
      "Error invoking remote method 'masar:premium-login': PremiumApiError: Email or password is incorrect.",
    );
    const cleaned = cleanError(original);

    expect(cleaned.message).toBe("Email or password is incorrect.");
    expect(cleaned.cause).toBe(original);
  });
});
