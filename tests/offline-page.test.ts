import { describe, expect, it } from "vitest";

import { connectionErrorPage } from "../desktop/src/offline-page";

describe("connectionErrorPage", () => {
  it("escapes diagnostics and keeps the retry origin script-safe", () => {
    const html = connectionErrorPage({
      origin: "https://example.com/?next=</script><script>alert(1)</script>",
      description: "<img src=x onerror=alert(1)>",
      canUseLocal: true,
    });

    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain("Use local workspace");
  });

  it("does not offer a local workspace action when it is unavailable", () => {
    const html = connectionErrorPage({
      origin: "https://example.com",
      description: "Network unreachable",
      canUseLocal: false,
    });

    expect(html).toContain("Try again");
    expect(html).not.toContain("Use local workspace");
  });
});
