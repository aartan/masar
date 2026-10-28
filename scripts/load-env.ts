import { config } from "dotenv";

// Load local overrides first so they win over checked-in defaults.
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
