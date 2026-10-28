import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DatabaseConfigurationError,
  isRemoteDatabaseUrl,
  resolveDatabaseConfig,
} from "@/db/config";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isRemoteDatabaseUrl", () => {
  it("recognizes hosted libSQL and HTTP URLs", () => {
    expect(isRemoteDatabaseUrl("libsql://masar.turso.io")).toBe(true);
    expect(isRemoteDatabaseUrl("https://masar.turso.io")).toBe(true);
    expect(isRemoteDatabaseUrl("wss://masar.turso.io")).toBe(true);
  });

  it("treats file and memory URLs as local", () => {
    expect(isRemoteDatabaseUrl("file:./data/app.db")).toBe(false);
    expect(isRemoteDatabaseUrl("file::memory:")).toBe(false);
  });
});

describe("resolveDatabaseConfig", () => {
  it("defaults to the persistent local SQLite file", () => {
    expect(resolveDatabaseConfig({})).toEqual({
      url: "file:./data/app.db",
      authToken: undefined,
      isRemote: false,
    });
  });

  it("prefers DATABASE_URL and supports the conventional Turso alias", () => {
    expect(
      resolveDatabaseConfig({ DATABASE_URL: "file:./tmp/custom.db" }).url,
    ).toBe("file:./tmp/custom.db");
    expect(
      resolveDatabaseConfig({
        TURSO_DATABASE_URL: "libsql://masar.turso.io",
        TURSO_AUTH_TOKEN: "token",
      }),
    ).toEqual({
      url: "libsql://masar.turso.io",
      authToken: "token",
      isRemote: true,
    });
  });

  it("accepts DATABASE_AUTH_TOKEN as an alias", () => {
    const config = resolveDatabaseConfig({
      DATABASE_URL: "libsql://masar.turso.io",
      DATABASE_AUTH_TOKEN: "token",
    });
    expect(config.authToken).toBe("token");
    expect(config.isRemote).toBe(true);
  });

  it("trims configured values", () => {
    expect(
      resolveDatabaseConfig({
        DATABASE_URL: "  file:./data/app.db  ",
        TURSO_AUTH_TOKEN: "  token  ",
      }),
    ).toEqual({
      url: "file:./data/app.db",
      authToken: "token",
      isRemote: false,
    });
  });

  it("fails clearly on Vercel without a database URL", () => {
    expect(() => resolveDatabaseConfig({ VERCEL: "1" })).toThrow(
      DatabaseConfigurationError,
    );
    expect(() => resolveDatabaseConfig({ VERCEL_ENV: "production" })).toThrow(
      /Missing production database configuration/,
    );
  });

  it("refuses a local file database on Vercel", () => {
    expect(() =>
      resolveDatabaseConfig({
        VERCEL: "1",
        DATABASE_URL: "file:./data/app.db",
      }),
    ).toThrow(/local file on Vercel/);
  });

  it("requires an auth token for hosted databases on Vercel", () => {
    expect(() =>
      resolveDatabaseConfig({
        VERCEL: "1",
        DATABASE_URL: "libsql://masar.turso.io",
      }),
    ).toThrow(/Missing TURSO_AUTH_TOKEN/);
  });

  it("accepts a fully configured Vercel deployment", () => {
    expect(
      resolveDatabaseConfig({
        VERCEL: "1",
        DATABASE_URL: "libsql://masar.turso.io",
        TURSO_AUTH_TOKEN: "secret",
      }),
    ).toEqual({
      url: "libsql://masar.turso.io",
      authToken: "secret",
      isRemote: true,
    });
  });

  it("warns when a production runtime falls back to a local file", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = resolveDatabaseConfig({ NODE_ENV: "production" });
    expect(config.url).toBe("file:./data/app.db");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("local SQLite file"));
  });

  it("does not warn when a local database is explicitly allowed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveDatabaseConfig({
      NODE_ENV: "production",
      ALLOW_LOCAL_DB_IN_PRODUCTION: "true",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn in development or test runtimes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveDatabaseConfig({ NODE_ENV: "development" });
    resolveDatabaseConfig({ NODE_ENV: "test" });
    expect(warn).not.toHaveBeenCalled();
  });
});
