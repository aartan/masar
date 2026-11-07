import { readFileSync } from "node:fs";
import path from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { handleRouteError } from "@/lib/api";
import { boardRoutes } from "./routes/boards";
import { projectRoutes } from "./routes/projects";
import { syncRoutes } from "./routes/sync";
import { taskRoutes } from "./routes/tasks";
import { workspaceRoutes } from "./routes/workspace";

export interface LocalAppOptions {
  /** Absolute directory containing the built SPA. Omit during Vite development. */
  staticDir?: string;
}

export function createLocalApp(options: LocalAppOptions = {}): Hono {
  const app = new Hono();

  app.use(
    "*",
    bodyLimit({
      maxSize: 32 * 1024 * 1024,
      onError: (c) =>
        c.json({ error: "The request is too large." }, 413),
    }),
  );

  const indexHtml = options.staticDir
    ? readFileSync(path.join(options.staticDir, "index.html"), "utf8")
    : null;

  app.route("/api", workspaceRoutes);
  app.route("/api", projectRoutes);
  app.route("/api", boardRoutes);
  app.route("/api", taskRoutes);
  app.route("/api", syncRoutes);

  app.all("/api/*", (c) =>
    c.json({ error: "Not found" }, 404),
  );

  if (options.staticDir && indexHtml) {
    app.use("*", serveStatic({ root: options.staticDir }));
    app.get("*", (c) => c.html(indexHtml));
  } else {
    app.get("/", (c) =>
      c.html(
        "<h1>Masar local API</h1><p>The Vite renderer is served separately during development.</p>",
      ),
    );
  }

  app.onError((error, _c) => handleRouteError(error));

  return app;
}
