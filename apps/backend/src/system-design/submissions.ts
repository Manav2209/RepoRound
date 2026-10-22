import { createHash } from "node:crypto";
import { Prisma, prisma } from "@repo/db";
import type {
  ArchitectureSnapshot,
  DesignGraphStatus,
  SubmitArchitectureRequest,
} from "@repo/voice-types";
import { newId } from "../lib/ids.js";
import { designGraphStore } from "./graph.js";
import { stateSchema } from "../interview/schemas.js";
import {
  InterviewBusyError,
  withInterviewLock,
} from "../interview/runtime-lock.js";

export class SubmissionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SubmissionError";
  }
}

export interface SubmissionOutcome {
  submissionId: string;
  revision: number;
  graphStatus: DesignGraphStatus;
  next: "START_INTERVIEW" | "RESUME_INTERVIEW";
  replayed: boolean;
}

export function snapshotHash(snapshot: ArchitectureSnapshot): string {
  const canonical = JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    nodes: snapshot.nodes.map((n) => ({
      id: n.id,
      position: { x: n.position.x, y: n.position.y },
      data: { componentType: n.data.componentType, label: n.data.label },
    })),
    edges: snapshot.edges
      .map((e) => ({ id: e.id, source: e.source, target: e.target }))
      .sort((a, b) =>
        a.source === b.source
          ? a.target.localeCompare(b.target)
          : a.source.localeCompare(b.source),
      ),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface ActiveSubmission {
  submissionId: string;
  revision: number;
  graphStatus: DesignGraphStatus;
  snapshot: ArchitectureSnapshot;
  createdAt: Date;
}

/** Latest READY revision only. A FAILED/BUILDING revision is never active. */
export async function getActiveSubmission(
  interviewId: string,
): Promise<ActiveSubmission | null> {
  const row = await prisma.systemDesignSubmission.findFirst({
    where: { interviewId, graphStatus: "READY" },
    orderBy: { revision: "desc" },
  });
  if (!row) return null;
  return {
    submissionId: row.id,
    revision: row.revision,
    graphStatus: "READY",
    snapshot: row.snapshot as unknown as ArchitectureSnapshot,
    createdAt: row.createdAt,
  };
}

export async function activeRevision(interviewId: string): Promise<number> {
  const active = await getActiveSubmission(interviewId);
  return active?.revision ?? 0;
}

export async function getReadySubmissionByRevision(
  interviewId: string,
  revision: number,
): Promise<ActiveSubmission | null> {
  const row = await prisma.systemDesignSubmission.findFirst({
    where: { interviewId, revision, graphStatus: "READY" },
  });
  if (!row) return null;
  return {
    submissionId: row.id,
    revision: row.revision,
    graphStatus: "READY",
    snapshot: row.snapshot as unknown as ArchitectureSnapshot,
    createdAt: row.createdAt,
  };
}

async function revisionAllowed(
  interviewId: string,
  expectedRevision: number,
): Promise<boolean> {
  if (expectedRevision === 0) return true;
  if (expectedRevision !== 1) return false;
  const active = await getActiveSubmission(interviewId);
  if (!active || active.revision !== 1) return false;
  const runtime = await prisma.interviewRuntime.findUnique({
    where: { interviewId },
  });
  if (!runtime) return false;
  try {
    const state = stateSchema.parse(runtime.data);
    return state.systemDesign?.phase === "REVISION_REQUESTED";
  } catch {
    return false;
  }
}

export async function submitArchitecture(input: {
  interviewId: string;
  request: SubmitArchitectureRequest;
}): Promise<SubmissionOutcome> {
  const { interviewId, request } = input;
  const snapshot = request.snapshot;
  const hash = snapshotHash(snapshot);

  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, mode: true },
  });
  if (!interview) throw new SubmissionError("Interview not found", 404);
  if (interview.mode !== "SYSTEM_DESIGN")
    throw new SubmissionError(
      "Interview is not a system design interview",
      409,
    );

  const replay = await prisma.systemDesignSubmission.findUnique({
    where: { requestId: request.requestId },
  });
  if (replay) {
    if (replay.interviewId !== interviewId || replay.snapshotHash !== hash)
      throw new SubmissionError(
        "Request ID was used with a different submission",
        409,
      );
    if (replay.graphStatus === "READY") {
      return replayReady(interviewId, replay);
    }
    if (replay.graphStatus === "BUILDING")
      throw new SubmissionError("Submission is still being processed", 409);
    return buildAndPublish(replay.id, snapshot, true);
  }

  if (!(await revisionAllowed(interviewId, request.expectedRevision)))
    throw new SubmissionError(
      "Revision is not permitted for the current interview stage",
      409,
    );

  const revision = request.expectedRevision + 1;
  let submissionId: string;
  try {
    const created = await prisma.systemDesignSubmission.create({
      data: {
        id: newId("ds"),
        interviewId,
        revision,
        requestId: request.requestId,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        snapshotHash: hash,
        graphStatus: "BUILDING",
      },
    });
    submissionId = created.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const concurrent = await prisma.systemDesignSubmission.findFirst({
        where: {
          OR: [{ requestId: request.requestId }, { interviewId, revision }],
        },
      });
      if (concurrent && concurrent.requestId === request.requestId) {
        if (
          concurrent.interviewId !== interviewId ||
          concurrent.snapshotHash !== hash
        )
          throw new SubmissionError(
            "Request ID was used with a different submission",
            409,
          );
        if (concurrent.graphStatus === "READY") {
          return replayReady(interviewId, concurrent);
        }
        if (concurrent.graphStatus === "FAILED")
          return buildAndPublish(concurrent.id, snapshot, true);
      }
      throw new SubmissionError("Revision already submitted", 409);
    }
    throw err;
  }
  return buildAndPublish(submissionId, snapshot, false);
}

function outcome(
  row: { id: string; revision: number },
  replayed: boolean,
): SubmissionOutcome {
  return {
    submissionId: row.id,
    revision: row.revision,
    graphStatus: "READY",
    next: row.revision === 1 ? "START_INTERVIEW" : "RESUME_INTERVIEW",
    replayed,
  };
}

async function replayReady(
  interviewId: string,
  row: { id: string; revision: number },
): Promise<SubmissionOutcome> {
  const runtime = await prisma.interviewRuntime.findUnique({
    where: { interviewId },
  });
  if (runtime) {
    const state = stateSchema.parse(runtime.data);
    const sd = state.systemDesign;
    if (
      state.ended ||
      (sd &&
        (sd.activeRevision > row.revision ||
          (sd.activeRevision === row.revision &&
            sd.activeSubmissionId === row.id &&
            (row.revision !== 2 || sd.revisionSubmitted))))
    )
      return outcome(row, true);
  }
  try {
    await publishActiveRevision(interviewId, row.id, row.revision);
  } catch (error) {
    if (error instanceof InterviewBusyError)
      throw new SubmissionError(
        "Interview is busy; retry the same request",
        503,
      );
    throw error;
  }
  return outcome(row, true);
}

async function buildAndPublish(
  submissionId: string,
  snapshot: ArchitectureSnapshot,
  replayed: boolean,
): Promise<SubmissionOutcome> {
  const row = await prisma.systemDesignSubmission.findUniqueOrThrow({
    where: { id: submissionId },
  });
  try {
    const store = designGraphStore();
    await store.install({
      interviewId: row.interviewId,
      submissionId: row.id,
      revision: row.revision,
      snapshot,
    });
    const verified = await store.verify({
      submissionId: row.id,
      revision: row.revision,
      expectedNodes: snapshot.nodes.length,
      expectedEdges: snapshot.edges.length,
    });
    if (
      verified.nodeCount !== snapshot.nodes.length ||
      verified.edgeCount !== snapshot.edges.length ||
      verified.crossSubmissionEdges !== 0
    )
      throw new Error(
        `Graph verification mismatch: ${JSON.stringify(verified)}`,
      );
    // READY and runtime publication commit together after graph verification.
    await publishActiveRevision(row.interviewId, row.id, row.revision);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.systemDesignSubmission.updateMany({
      where: { id: submissionId, graphStatus: { in: ["BUILDING", "FAILED"] } },
      data: { graphStatus: "FAILED", graphError: message.slice(0, 500) },
    });
    throw new SubmissionError(
      err instanceof InterviewBusyError
        ? "Interview is busy; retry the same request"
        : "Submission publication failed; retry the same request",
      503,
    );
  }

  return outcome(row, replayed);
}

async function publishActiveRevision(
  interviewId: string,
  submissionId: string,
  revision: number,
): Promise<void> {
  const markReady = async (tx: Prisma.TransactionClient) => {
    const updated = await tx.systemDesignSubmission.updateMany({
      where: { id: submissionId, interviewId },
      data: { graphStatus: "READY", graphError: null, readyAt: new Date() },
    });
    if (!updated.count)
      throw new Error("Submission disappeared during publication");
  };
  const runtime = await prisma.interviewRuntime.findUnique({
    where: { interviewId },
  });
  if (!runtime) {
    await prisma.$transaction(async (tx) => {
      await tx.interview.updateMany({
        where: { id: interviewId, status: "created" },
        data: { status: "ready", error: null },
      });
      await markReady(tx);
    });
    return;
  }
  await withInterviewLock(interviewId, async (token) => {
    const row = await prisma.interviewRuntime.findUniqueOrThrow({
      where: { interviewId },
    });
    const state = stateSchema.parse(row.data);
    if (!state.systemDesign)
      throw new Error("System design runtime is missing");
    // Replaying an old revision must never roll back a newer published design.
    if (state.systemDesign.activeRevision > revision) return;
    if (
      state.systemDesign.activeSubmissionId === submissionId &&
      state.systemDesign.activeRevision === revision &&
      (revision !== 2 || state.systemDesign.revisionSubmitted)
    )
      return;
    state.systemDesign.activeRevision = revision;
    state.systemDesign.activeSubmissionId = submissionId;
    if (revision === 2) state.systemDesign.revisionSubmitted = true;
    await prisma.$transaction(async (tx) => {
      const updated = await tx.interviewRuntime.updateMany({
        where: { interviewId, version: row.version, leaseToken: token },
        data: {
          data: state as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (!updated.count)
        throw new Error("Runtime changed while publishing submission");
      await markReady(tx);
    });
  });
}
