import { serve } from "@hono/node-server";

import { createLocalApp } from "./app";

const port = Number(process.env.PORT ?? 4782);
const hostname = process.env.HOSTNAME?.trim() || "127.0.0.1";
const staticDir = process.env.MASAR_STATIC_DIR?.trim() || undefined;
const app = createLocalApp({ staticDir });

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const server = serve({ fetch: app.fetch, hostname, port }, (info) => {
  console.log(
    `[masar] local server listening on http://${hostname}:${info.port}${
      staticDir ? ` (renderer: ${staticDir})` : ""
    }`,
  );
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[masar] local server shutting down (${signal})`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
