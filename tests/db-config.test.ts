import { describe, expect, it } from "vitest";

import { resolveDatabaseConfig } from "@/db/config";

describe("resolveDatabaseConfig", () => {
  it("defaults to the persistent local SQLite file", () => {
    expect(resolveDatabaseConfig({})).toEqual({
      url: "file:./data/app.db",
      authToken: undefined,
    });
  });

  it("uses DATABASE_URL and trims values", () => {
    expect(
      resolveDatabaseConfig({
        DATABASE_URL: "  file:./data/custom.db  ",
        DATABASE_AUTH_TOKEN: "  token  ",
      }),
    ).toEqual({ url: "file:./data/custom.db", authToken: "token" });
  });
});
