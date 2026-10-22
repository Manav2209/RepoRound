import type { Context, Next } from "hono";
import type { BackendConfig } from "../config.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@repo/db";

export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const window = Math.floor(Date.now() / windowMs);
  const row = await prisma.rateLimitBucket.upsert({
    where: { id: `${key}:${window}` },
    create: {
      id: `${key}:${window}`,
      count: 1,
      resetAt: new Date((window + 1) * windowMs),
    },
    update: { count: { increment: 1 } },
  });
  return row.count <= limit;
}

export function createAuthMiddleware(token: string) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const header = c.req.header("authorization") ?? "";
    const prefix = "Bearer ";
    const provided = header.startsWith(prefix)
      ? header.slice(prefix.length)
      : "";
    if (
      !provided ||
      !timingSafeEqual(
        Buffer.from(tokenHash(provided)),
        Buffer.from(tokenHash(token)),
      )
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}

export function internalAuthFromConfig(cfg: BackendConfig) {
  return createAuthMiddleware(cfg.INTERNAL_API_TOKEN);
}
