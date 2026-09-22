import { describe, expect, it } from "vitest";

import { getTrustedAuthOrigins } from "@/lib/auth-origins";

function request(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { headers });
}

describe("getTrustedAuthOrigins", () => {
  it("trusts the configured URL and its loopback spellings", () => {
    const origins = getTrustedAuthOrigins({
      baseURL: "http://localhost:3000",
      nodeEnv: "production",
    });

    expect(origins).toEqual(
      expect.arrayContaining([
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
      ]),
    );
  });

  it("accepts alternate loopback hosts in development", () => {
    const origins = getTrustedAuthOrigins({
      request: request("http://localhost:3000/api/auth/sign-up/email", {
        origin: "http://127.0.0.1:3000",
      }),
      nodeEnv: "development",
    });

    expect(origins).toContain("http://127.0.0.1:3000");
  });

  it("does not trust another localhost port in development", () => {
    const origins = getTrustedAuthOrigins({
      request: request("http://localhost:3000/api/auth/sign-up/email", {
        origin: "http://localhost:9999",
      }),
      nodeEnv: "development",
    });

    expect(origins).not.toContain("http://localhost:9999");
  });

  it("accepts the public host forwarded by a proxy", () => {
    const origins = getTrustedAuthOrigins({
      request: request("http://internal:3000/api/auth/sign-up/email", {
        origin: "https://masar.example.com",
        "x-forwarded-host": "masar.example.com",
        "x-forwarded-proto": "https",
      }),
      nodeEnv: "production",
    });

    expect(origins).toContain("https://masar.example.com");
  });

  it("does not trust an unrelated origin", () => {
    const origins = getTrustedAuthOrigins({
      request: request("https://masar.example.com/api/auth/sign-up/email", {
        origin: "https://evil.example.com",
      }),
      baseURL: "https://masar.example.com",
      nodeEnv: "production",
    });

    expect(origins).not.toContain("https://evil.example.com");
  });

  it("does not accept a loopback mismatch in production", () => {
    const origins = getTrustedAuthOrigins({
      request: request("http://localhost:3000/api/auth/sign-up/email", {
        origin: "http://127.0.0.1:3000",
      }),
      nodeEnv: "production",
    });

    expect(origins).not.toContain("http://127.0.0.1:3000");
  });
});
