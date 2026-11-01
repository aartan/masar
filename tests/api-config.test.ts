import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_URL,
  normalizeApiUrl,
  selectApiUrl,
  validateApiUrl,
} from "../desktop/src/api-config";

describe("Premium API configuration", () => {
  it("defaults to the hosted HTTPS API", () => {
    expect(DEFAULT_API_URL).toBe("https://masar-api-1hn1.onrender.com");
    expect(validateApiUrl(DEFAULT_API_URL)).toBe(DEFAULT_API_URL);
  });

  it("normalizes surrounding whitespace and trailing slashes", () => {
    expect(normalizeApiUrl("  https://masar-api-1hn1.onrender.com///  ")).toBe(
      "https://masar-api-1hn1.onrender.com",
    );
    expect(validateApiUrl("https://masar-api-1hn1.onrender.com/")).toBe(
      "https://masar-api-1hn1.onrender.com",
    );
  });

  it("rejects unencrypted remote API addresses", () => {
    expect(() => validateApiUrl("http://masar-api-1hn1.onrender.com")).toThrow(
      /HTTPS/,
    );
  });

  it("allows loopback HTTP for local development", () => {
    expect(validateApiUrl("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787",
    );
    expect(validateApiUrl("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
  });

  it("ignores the environment override in packaged builds", () => {
    expect(
      selectApiUrl({
        packaged: true,
        environmentUrl: "https://self-hosted.example.com",
      }),
    ).toBe(DEFAULT_API_URL);
  });

  it("uses the environment override during development", () => {
    expect(
      selectApiUrl({
        packaged: false,
        environmentUrl: "http://127.0.0.1:8787",
      }),
    ).toBe("http://127.0.0.1:8787");
  });

  it("uses the address baked into a packaged build", () => {
    expect(
      selectApiUrl({
        packaged: true,
        environmentUrl: "https://self-hosted.example.com",
        configuredUrl: "https://staging.example.com",
      }),
    ).toBe("https://staging.example.com");
  });
});
