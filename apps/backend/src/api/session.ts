import type { Context, Next } from "hono";
import type { Auth } from "../auth/index.js";
import { prisma } from "@repo/db";
import { rateLimit } from "./security.js";

export type BrowserSession = NonNullable<
  Awaited<ReturnType<Auth["api"]["getSession"]>>
>;

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    browserSession: BrowserSession;
  }
}

export function browserSessionMiddleware(auth: Auth) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) {
      return c.json(
        { error: "Authentication required", code: "UNAUTHENTICATED" },
        401,
      );
    }
    if (!session.user.emailVerified) {
      return c.json(
        { error: "Verify your email to continue", code: "EMAIL_NOT_VERIFIED" },
        403,
      );
    }
    c.set("userId", session.user.id);
    c.set("browserSession", session);
    c.header("Cache-Control", "no-store");
    await next();
  };
}

export function interviewOwnership() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const userId = c.get("userId");
    const interviewId = c.req.path.match(
      /^\/api\/v1\/interviews\/([^/]+)/,
    )?.[1];
    if (interviewId) {
      const interview = await prisma.interview.findFirst({
        where: { id: interviewId, userId }, select: { id: true },
      });
      const reportPath = /\/(result|report|transcript)$/.test(c.req.path);
      const report = interview || !reportPath ? null : await prisma.report.findFirst({
        where: { interviewId, userId }, select: { id: true },
      });
      if (!interview && !report) return c.json({ error: "Interview not found" }, 404);
    }
    const isCreate =
      c.req.method === "POST" && c.req.path === "/api/v1/interviews";
    if (
      !(await rateLimit(
        `${userId}:${isCreate ? "create" : "read"}`,
        isCreate ? 10 : 120,
        isCreate ? 3_600_000 : 60_000,
      ))
    ) {
      return c.json({ error: "Too many requests" }, 429);
    }
    c.header("Cache-Control", "no-store");
    await next();
  };
}
