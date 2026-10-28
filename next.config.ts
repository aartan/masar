import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` emits a self-contained `.next/standalone/server.js` that the
  // Electron desktop build forks directly. It is a no-op for the Vercel/web
  // deploy (Vercel uses its own adapter) and does not change `next start`.
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
  // The libSQL driver loads its native addon through a computed
  // `require(`@libsql/${target}`)`, which @vercel/nft cannot trace statically.
  // Force the JS packages into the standalone trace here; the native per-arch
  // `@libsql/<platform>-<arch>` binaries are copied in by
  // `desktop/scripts/prepare-standalone.ts` (which also handles cross-arch).
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/libsql/**",
      "node_modules/@libsql/client/**",
      "node_modules/@libsql/core/**",
      "node_modules/@libsql/hrana-client/**",
      "node_modules/@libsql/isomorphic-ws/**",
    ],
  },
};

export default nextConfig;
