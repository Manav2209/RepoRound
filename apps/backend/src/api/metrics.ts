import { Hono } from "hono";
import {
  readUserMetrics,
  metricPricingFromEnv,
  type MetricPricing,
} from "../observability/metrics.js";

export function createMetricsRouter(
  pricing: MetricPricing = metricPricingFromEnv(),
): Hono {
  const app = new Hono();
  app.get("/", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Authentication required" }, 401);
    c.header("Cache-Control", "no-store");
    return c.json(await readUserMetrics(userId, pricing));
  });
  return app;
}
