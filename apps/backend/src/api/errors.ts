import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

export async function requestCorrelation(c: Context, next: Next) {
  c.set("requestId", crypto.randomUUID());
  c.header("X-Request-Id", c.get("requestId"));
  await next();
}

export function serverError(
  c: Context,
  error: unknown,
  status: ContentfulStatusCode = 500,
) {
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  c.header("X-Request-Id", requestId);
  console.error("API request failed", { requestId, error });
  return c.json({ error: "Internal error", requestId }, status);
}
