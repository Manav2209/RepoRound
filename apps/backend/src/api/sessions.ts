import { Hono } from "hono";
import type {
  SessionService,
  StartSessionResult,
} from "../realtime/session.service.js";
import { SessionError } from "../realtime/session.service.js";
import { serverError } from "./errors.js";

export function createSessionsRouter(sessions: SessionService): Hono {
  const app = new Hono();

  app.post("/:interviewId/session", async (c) => {
    const { interviewId } = c.req.param();
    try {
      const result: StartSessionResult =
        await sessions.startForInterview(interviewId);
      return c.json(
        {
          interviewId: result.interviewId,
          sessionId: result.sessionId,
          roomName: result.roomName,
          serverUrl: result.serverUrl,
          token: result.token,
        },
        201,
      );
    } catch (err) {
      if (err instanceof SessionError && err.status && err.status < 500) {
        return c.json({ error: err.message }, err.status ?? 500);
      }
      return serverError(
        c,
        err,
        err instanceof SessionError ? (err.status ?? 500) : 500,
      );
    }
  });

  return app;
}
