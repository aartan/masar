/**
 * Central hosted Masar URL used by premium sync mode. This is managed by you,
 * the operator: set it to your deployed Masar origin. In sync mode the desktop
 * window loads this URL and the user signs in there, so no database credentials
 * ever ship inside the app.
 *
 * Resolution order (see settings.ts `resolveSyncUrl`):
 *   1. a value the app has stored,
 *   2. the MASAR_SYNC_URL environment variable (e.g. injected at build time),
 *   3. this default.
 */
export const DEFAULT_SYNC_URL = "https://next-kanban-gamma.vercel.app";
