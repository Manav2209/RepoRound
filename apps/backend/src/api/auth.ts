import { Hono } from "hono";
import type { BackendConfig } from "../config.js";

export function createAuthCapabilitiesRouter(config: BackendConfig): Hono {
  const app = new Hono();
  app.get("/capabilities", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({
      emailPassword: true,
      providers: {
        google: Boolean(
          config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET,
        ),
        github: Boolean(
          config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET,
        ),
      },
    });
  });
  return app;
}
