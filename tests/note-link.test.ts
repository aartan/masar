import { describe, expect, it } from "vitest";

import { validateNoteLinkUrl } from "@/lib/note-link";

describe("validateNoteLinkUrl", () => {
  it("accepts http and https URLs with a host", () => {
    expect(validateNoteLinkUrl("https://example.com")).toEqual({
      ok: true,
      url: "https://example.com",
    });
    expect(validateNoteLinkUrl("http://example.com/path?q=1")).toEqual({
      ok: true,
      url: "http://example.com/path?q=1",
    });
  });

  it("prefixes bare web addresses with https", () => {
    expect(validateNoteLinkUrl("example.com")).toEqual({
      ok: true,
      url: "https://example.com",
    });
    expect(validateNoteLinkUrl("sub.example.com/page")).toEqual({
      ok: true,
      url: "https://sub.example.com/page",
    });
  });

  it("accepts mailto and tel links", () => {
    expect(validateNoteLinkUrl("mailto:user@example.com")).toEqual({
      ok: true,
      url: "mailto:user@example.com",
    });
    expect(validateNoteLinkUrl("tel:+15551234567")).toEqual({
      ok: true,
      url: "tel:+15551234567",
    });
    expect(validateNoteLinkUrl("tel:(555) 123-4567")).toEqual({
      ok: true,
      url: "tel:(555)123-4567",
    });
  });

  it("rejects disallowed protocols outright", () => {
    const result = validateNoteLinkUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
    expect(validateNoteLinkUrl("data:text/html,x").ok).toBe(false);
    expect(validateNoteLinkUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects empty and whitespace input", () => {
    expect(validateNoteLinkUrl("")).toEqual({ ok: false, message: "Enter a link." });
    expect(validateNoteLinkUrl("   ").ok).toBe(false);
  });

  it("rejects values with internal whitespace", () => {
    expect(validateNoteLinkUrl("https://exa mple.com").ok).toBe(false);
  });

  it("rejects incomplete web addresses", () => {
    expect(validateNoteLinkUrl("https://").ok).toBe(false);
    expect(validateNoteLinkUrl("not a url").ok).toBe(false);
  });

  it("rejects incomplete mailto and tel links", () => {
    expect(validateNoteLinkUrl("mailto:").ok).toBe(false);
    expect(validateNoteLinkUrl("mailto:not-an-email").ok).toBe(false);
    expect(validateNoteLinkUrl("tel:").ok).toBe(false);
    expect(validateNoteLinkUrl("tel:abc").ok).toBe(false);
  });

  it("rejects javascript-ish schemes regardless of casing", () => {
    expect(validateNoteLinkUrl("JAVASCRIPT:alert(1)").ok).toBe(false);
    expect(validateNoteLinkUrl("JaVaScRiPt:alert(1)").ok).toBe(false);
  });
});
