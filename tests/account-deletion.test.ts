import { afterEach, describe, expect, it, vi } from "vitest";

import { isDeleteAccountConfirmed } from "@/lib/account-deletion";
import { DELETE_ACCOUNT_PHRASE } from "@/lib/premium-types";
import { PremiumApiClient } from "../desktop/src/premium/client";
import type { PremiumApiError } from "../desktop/src/premium/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account deletion confirmation", () => {
  it("accepts only the exact phrase", () => {
    expect(DELETE_ACCOUNT_PHRASE).toBe("DELETE");
    expect(isDeleteAccountConfirmed(DELETE_ACCOUNT_PHRASE)).toBe(true);
  });

  it("rejects wrong case, whitespace, and partial phrases", () => {
    for (const value of [
      "",
      "delete",
      "Delete",
      "DELETE ",
      " DELETE",
      "DELETEE",
      "delete my account",
    ]) {
      expect(isDeleteAccountConfirmed(value)).toBe(false);
    }
  });
});

describe("PremiumApiClient.deleteAccount", () => {
  it("sends an authenticated DELETE with the exact confirmation", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new PremiumApiClient("http://127.0.0.1:8787", "session-token");
    await expect(client.deleteAccount(DELETE_ACCOUNT_PHRASE)).resolves.toEqual({
      deleted: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:8787/v1/auth/account");
    expect(init?.method).toBe("DELETE");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer session-token",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      confirmation: DELETE_ACCOUNT_PHRASE,
    });
  });

  it("surfaces the server's confirmation field error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "Please check the submitted values.",
            code: "validation_failed",
            fieldErrors: {
              confirmation: 'Type "DELETE" exactly to confirm.',
            },
          }),
          {
            status: 422,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const client = new PremiumApiClient("http://127.0.0.1:8787", "session-token");
    await expect(client.deleteAccount("wrong phrase")).rejects.toMatchObject({
      name: "PremiumApiError",
      status: 422,
      message: 'Type "DELETE" exactly to confirm.',
      fieldErrors: {
        confirmation: 'Type "DELETE" exactly to confirm.',
      },
    } satisfies Partial<PremiumApiError>);
  });
});
