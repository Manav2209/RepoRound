import { prisma, Prisma } from "@repo/db";
import { LiveKitService } from "./livekit.service.js";
import { newId, newSessionId } from "../lib/ids.js";
import type { BackendConfig } from "../config.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { initialState, initialSystemDesignState } from "../interview/schemas.js";
import { getActiveSubmission } from "../system-design/submissions.js";
import { getProblem } from "../system-design/problems.js";
import { objectivesForProblem } from "../interview/strategies/system-design.js";

export interface StartSessionResult {
  interviewId: string;
  sessionId: string;
  roomName: string;
  serverUrl: string;
  token: string;
}
export class SessionService {
  private readonly livekit: LiveKitService;
  constructor(
    private readonly cfg: Pick<
      BackendConfig,
      "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET"
    > &
      Partial<
        Pick<
          BackendConfig,
          | "RECONNECT_WINDOW_SECONDS"
          | "INTERVIEW_DURATION_MINUTES"
          | "GITHUB_INTERVIEW_DURATION_MINUTES"
        >
      >,
    private readonly agentName = "ai-interviewer",
  ) {
    this.livekit = new LiveKitService(cfg);
  }
  async startForInterview(interviewId: string): Promise<StartSessionResult> {
    const leaseToken = newId("dispatch");
    const activeDesign = await getActiveSubmission(interviewId);
    const reserved = await prisma.$transaction(async (tx) => {
      // Serialize allocation across backend processes; dispatch happens after the row exists.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${interviewId}))::text`;
      const interview = await tx.interview.findUnique({
        where: { id: interviewId },
        include: { runtime: true, interviewPlan: true },
      });
      if (!interview) throw new SessionError("Interview not found", 404);
      if (!["ready", "active"].includes(interview.status))
        throw new SessionError("Interview cannot be resumed", 409);
      if (interview.mode === "SYSTEM_DESIGN" && !activeDesign)
        throw new SessionError(
          "Submit your architecture before starting the interview",
          409,
        );
      if (
        interview.mode === "SYSTEM_DESIGN" &&
        !getProblem(interview.systemDesignProblemId ?? "")
      )
        throw new SessionError("Unknown system design problem", 409);
      const now = new Date();
      if (
        interview.runtime &&
        (interview.runtime.deadlineAt <= now ||
          (interview.runtime.data as { ended?: boolean }).ended)
      )
        throw new SessionError("Interview time has ended", 409);
      const existing = await tx.interviewSession.findFirst({
        where: { interviewId },
        orderBy: { createdAt: "desc" },
      });
      if (existing?.dispatchLeaseUntil && existing.dispatchLeaseUntil > now)
        throw new SessionError("Voice session is starting. Please retry.", 503);
      if (
        existing?.disconnectedAt &&
        now.getTime() - existing.disconnectedAt.getTime() >
          (this.cfg.RECONNECT_WINDOW_SECONDS ?? 300) * 1000
      )
        throw new SessionError("Reconnect window has expired", 409);
      if (
        existing?.status === "active" &&
        !existing.disconnectedAt &&
        existing.heartbeatAt &&
        now.getTime() - existing.heartbeatAt.getTime() < 60_000
      )
        return { session: existing, dispatch: false };
      // A successful dispatch may take a few seconds to register its first heartbeat.
      if (
        existing?.status === "created" &&
        !existing.disconnectedAt &&
        now.getTime() - existing.createdAt.getTime() < 30_000 &&
        !existing.dispatchLeaseToken
      )
        return { session: existing, dispatch: false };
      const sessionId = existing?.id ?? newSessionId();
      const data = {
        status: "created" as const,
        dispatchLeaseToken: leaseToken,
        dispatchLeaseUntil: new Date(now.getTime() + 60_000),
        serverUrl: this.livekit.serverUrl(),
      };
      const session = existing
        ? await tx.interviewSession.update({ where: { id: sessionId }, data })
        : await tx.interviewSession.create({
            data: {
              id: sessionId,
              interviewId,
              roomName: `interview-${interviewId}-${sessionId}`,
              ...data,
            },
          });
      if (!interview.runtime) {
        const problem =
          interview.mode === "SYSTEM_DESIGN"
            ? getProblem(interview.systemDesignProblemId ?? "")
            : null;
        const initialData =
          interview.mode === "SYSTEM_DESIGN" && problem && activeDesign
            ? initialSystemDesignState({
                problemId: problem.id,
                activeRevision: activeDesign.revision,
                activeSubmissionId: activeDesign.submissionId,
                objectives: objectivesForProblem(problem),
                difficulty: problem.difficulty,
              })
            : initialState(
                interview.interviewPlan?.objectives,
                interview.interviewPlan?.difficulty ?? "mid",
                {
                  githubDurationMinutes:
                    this.cfg.GITHUB_INTERVIEW_DURATION_MINUTES ?? 15,
                },
              );
        const durationMinutes =
          interview.mode === "SYSTEM_DESIGN"
            ? (this.cfg.INTERVIEW_DURATION_MINUTES ?? 30)
            : (this.cfg.GITHUB_INTERVIEW_DURATION_MINUTES ?? 15);
        await tx.interviewRuntime.create({
          data: {
            interviewId,
            deadlineAt: new Date(now.getTime() + durationMinutes * 60_000),
            data: initialData as unknown as Prisma.InputJsonValue,
          },
        });
      }
      await tx.interview.update({
        where: { id: interviewId },
        data: { status: "active", startedAt: interview.startedAt ?? now },
      });
      return { session, dispatch: true };
    });
    const session = reserved.session;
    let token: string;
    try {
      if (reserved.dispatch) {
        if (session.startedAt || session.disconnectedAt)
          await this.livekit.cleanupRoom(session.roomName);
        const created = await this.livekit.createSession({
          roomName: session.roomName,
          interviewId,
          sessionId: session.id,
          identity: `candidate-${interviewId}`,
          agentName: this.agentName,
          ttlSeconds: 3600,
        });
        token = created.candidateToken;
        await prisma.interviewSession.updateMany({
          where: { id: session.id, dispatchLeaseToken: leaseToken },
          data: {
            dispatchLeaseToken: null,
            dispatchLeaseUntil: null,
            disconnectedAt: null,
          },
        });
      } else
        token = await this.livekit.issueCandidateToken(
          session.roomName,
          `candidate-${interviewId}`,
          3600,
        );
    } catch (err) {
      await prisma.interviewSession.updateMany({
        where: { id: session.id, dispatchLeaseToken: leaseToken },
        data: {
          dispatchLeaseToken: null,
          dispatchLeaseUntil: null,
          disconnectedAt: new Date(),
        },
      });
      throw err;
    }
    return {
      interviewId,
      sessionId: session.id,
      roomName: session.roomName,
      serverUrl: session.serverUrl,
      token,
    };
  }
}
export class SessionError extends Error {
  constructor(
    message: string,
    readonly status?: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "SessionError";
  }
}
