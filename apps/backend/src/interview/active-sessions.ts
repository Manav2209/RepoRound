import { Prisma, prisma } from "@repo/db";
import { RepositoryKnowledge } from "../github/knowledge.js";
import { stateSchema } from "./schemas.js";
import type { InterviewState } from "./interview.types.js";
import { withInterviewLock } from "./runtime-lock.js";

type Turn = Prisma.ConversationTurnCreateManyInput;
type Event = Prisma.InterviewEventCreateManyInput;
export class ActiveSessionLostError extends Error {}
export const turnCancelled = () =>
  new DOMException("Interview turn was cancelled", "AbortError");

export interface ActiveInterview {
  interviewId: string;
  sessionId: string;
  userId: string;
  state: InterviewState;
  version: number;
  deadlineAt: Date;
  knowledge: RepositoryKnowledge;
  turns: Turn[];
  events: Event[];
  eventIds: Set<string>;
  cancelled: Set<string>;
  connected: boolean;
  disconnectedAt?: Date;
  turnBudget?: { window: number; count: number };
  eventBudget?: { window: number; count: number };
  frozen: boolean;
  persisted: boolean;
  persistedAt?: number;
  bytes: number;
  droppedEvents: number;
  sequence: number;
  current?: {
    id: string;
    token: string;
    controller: AbortController;
    promise: Promise<unknown>;
  };
  lastCommit?: { turnId: string; state: InterviewState; version: number };
  flushing?: Promise<void>;
}

const MAX_SESSIONS = 32;
const MAX_BYTES = 128 * 1024 * 1024;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Single-process active state. Only completed sessions are flushed for evaluation. */
export class ActiveSessionStore {
  readonly owner = crypto.randomUUID();
  private readonly sessions = new Map<string, ActiveInterview>();
  peek(id: string): ActiveInterview | undefined {
    return this.sessions.get(id);
  }
  forUser(userId: string) {
    return [...this.sessions.values()].filter((row) => row.userId === userId);
  }

  require(id: string, sessionId: string) {
    const entry = this.sessions.get(id);
    if (!entry || entry.sessionId !== sessionId)
      throw new ActiveSessionLostError(
        "Interview session is unavailable; start a new interview",
      );
    return entry;
  }

  admitTurn(id: string, sessionId: string) {
    const entry = this.require(id, sessionId);
    const window = Math.floor(Date.now() / 60_000);
    if (entry.turnBudget?.window !== window)
      entry.turnBudget = { window, count: 0 };
    return ++entry.turnBudget!.count <= 30;
  }

  admitEvent(id: string, sessionId: string) {
    const entry = this.require(id, sessionId);
    const window = Math.floor(Date.now() / 60_000);
    if (entry.eventBudget?.window !== window)
      entry.eventBudget = { window, count: 0 };
    return ++entry.eventBudget!.count <= 180;
  }

  all() {
    return [...this.sessions.values()];
  }

  addTurn(id: string, turn: Turn) {
    const entry = this.peek(id)!;
    const size = bytes(turn);
    if (
      entry.turns.length >= 1000 ||
      entry.bytes + size > 16 * 1024 * 1024 ||
      this.all().reduce((n, item) => n + item.bytes, size) > MAX_BYTES
    )
      throw new ActiveSessionLostError(
        "Interview memory limit reached; end this interview",
      );
    entry.bytes += size;
    entry.turns.push(turn);
  }

  async activate(
    interviewId: string,
    sessionId: string,
  ): Promise<ActiveInterview> {
    const cached = this.peek(interviewId);
    if (cached) return this.require(interviewId, sessionId);
    return withInterviewLock(interviewId, async (token) => {
      const row = await prisma.interviewRuntime.findUniqueOrThrow({
        where: { interviewId },
        include: {
          interview: {
            select: {
              userId: true,
              mode: true,
              status: true,
              sessions: { where: { id: sessionId }, select: { id: true } },
            },
          },
        },
      });
      const state = stateSchema.parse(row.data);
      if (state.activeStorage === "memory")
        throw new ActiveSessionLostError(
          "Active interview memory was lost; start a new interview",
        );
      if (
        row.interview.mode !== "GITHUB" ||
        row.interview.status !== "active" ||
        !row.interview.sessions.length
      )
        throw new Error("Invalid active repository session");
      const [knowledge, turns] = await Promise.all([
        RepositoryKnowledge.load(interviewId),
        prisma.conversationTurn.findMany({
          where: { interviewId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ]);
      const size = bytes({ knowledge, state, turns });
      if (
        this.sessions.size >= MAX_SESSIONS ||
        [...this.sessions.values()].reduce((n, item) => n + item.bytes, size) >
          MAX_BYTES
      )
        throw new Error("Active interview capacity reached; retry later");
      state.activeStorage = "memory";
      state.activeOwner = this.owner;
      await prisma.interviewRuntime.update({
        where: { interviewId, leaseToken: token, version: row.version },
        data: {
          data: state as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      const entry: ActiveInterview = {
        interviewId,
        sessionId,
        userId: row.interview.userId,
        state,
        version: row.version + 1,
        deadlineAt: row.deadlineAt,
        knowledge,
        turns,
        events: [],
        eventIds: new Set(),
        cancelled: new Set(),
        connected: true,
        frozen: false,
        persisted: false,
        bytes: size,
        droppedEvents: 0,
        sequence: 0,
      };
      this.sessions.set(interviewId, entry);
      return entry;
    });
  }

  record(id: string, event: Event): boolean {
    const entry = this.peek(id);
    if (!entry || entry.persisted) return false;
    if (entry.eventIds.has(event.id)) return true;
    const size = bytes(event);
    if (
      entry.events.length >= 10_000 ||
      entry.bytes + size > 16 * 1024 * 1024 ||
      this.all().reduce((n, item) => n + item.bytes, size) > MAX_BYTES
    ) {
      entry.droppedEvents++;
      return true;
    }
    entry.bytes += size;
    entry.eventIds.add(event.id);
    entry.events.push({ ...event, createdAt: event.createdAt ?? new Date() });
    return true;
  }

  async run<T>(
    id: string,
    turnId: string,
    operation: (token: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const entry = this.peek(id)!;
    if (entry.cancelled.has(turnId)) throw turnCancelled();
    if (entry.current?.id === turnId)
      return entry.current.promise as Promise<T>;
    const sequence = ++entry.sequence;
    if (entry.current) {
      this.cancel(id, entry.current.id);
      await entry.current?.promise.catch(() => {});
    }
    if (entry.sequence !== sequence) throw turnCancelled();
    if (entry.frozen || !entry.connected)
      throw new ActiveSessionLostError(
        "Interview has ended; start a new interview",
      );
    const controller = new AbortController();
    const token = crypto.randomUUID();
    // Install ownership before invoking user code, including synchronously resolving stubs.
    const promise = Promise.resolve().then(() =>
      operation(token, controller.signal),
    );
    entry.current = { id: turnId, token, controller, promise };
    try {
      return await promise;
    } finally {
      if (entry.current?.token === token) entry.current = undefined;
    }
  }

  cancel(id: string, turnId: string) {
    const entry = this.peek(id);
    if (!entry || entry.frozen) return;
    entry.cancelled.add(turnId);
    if (entry.current?.id === turnId)
      entry.current.controller.abort(turnCancelled());
    // A response cancelled before speech may already have committed locally.
    // Restore only the most recent commit; preserve its original answer for evaluation.
    if (entry.lastCommit?.turnId === turnId) {
      entry.state = entry.lastCommit.state;
      entry.version = entry.lastCommit.version;
      const turn = entry.turns.find((item) => item.id === turnId);
      if (turn) turn.analysisStatus = "pending";
      entry.lastCommit = undefined;
    }
  }

  commit(
    id: string,
    token: string,
    version: number,
    state: InterviewState,
    events: Event[],
    turn?: { id: string; status: string; error?: string },
  ) {
    const entry = this.peek(id)!;
    if (
      entry.current?.token !== token ||
      entry.version !== version ||
      entry.frozen
    )
      throw turnCancelled();
    entry.current.controller.signal.throwIfAborted();
    stateSchema.parse(state);
    entry.lastCommit = {
      turnId: entry.current.id,
      state: entry.state,
      version: entry.version,
    };
    entry.state = state;
    entry.version++;
    if (turn) {
      const saved = entry.turns.find((item) => item.id === turn.id);
      if (saved) {
        saved.analysisStatus = turn.status;
        saved.analysisError = turn.error ?? null;
      }
    }
    for (const event of events) this.record(id, event);
  }

  async flush(id: string, reason = "candidate_requested"): Promise<void> {
    const entry = this.peek(id);
    if (!entry || entry.persisted) return;
    if (entry.flushing) return entry.flushing;
    entry.frozen = true;
    entry.current?.controller.abort(turnCancelled());
    entry.flushing = (async () => {
      await entry.current?.promise.catch(() => {});
      const state = structuredClone(entry.state);
      state.ended = true;
      state.endReason ??= reason;
      state.phase = "FINAL";
      state.activeFlushed = true;
      // No model calls inside this transaction. Do not enqueue evaluation until it commits.
      await withInterviewLock(id, async (token) => {
        const turns = entry.turns.map((turn) => ({ ...turn }));
        const events = entry.events.slice();
        await prisma.$transaction(
          async (tx) => {
            const runtime = await tx.interviewRuntime.update({
              where: { interviewId: id, leaseToken: token },
              data: {
                data: state as unknown as Prisma.InputJsonValue,
                version: { increment: 1 },
              },
            });
            await tx.interviewMemoryProjection.upsert({
              where: { interviewId: id },
              create: { interviewId: id, version: runtime.version },
              update: { version: runtime.version },
            });
            if (turns.length)
              await tx.conversationTurn.createMany({
                data: turns,
                skipDuplicates: true,
              });
            if (events.length)
              await tx.interviewEvent.createMany({
                data: events,
                skipDuplicates: true,
              });
            await tx.interview.updateMany({
              where: { id, status: "active" },
              data: { status: "completing" },
            });
            await tx.interviewJob.upsert({
              where: { key: `END:${id}` },
              create: {
                id: `job_${crypto.randomUUID()}`,
                interviewId: id,
                kind: "END",
                key: `END:${id}`,
                payload: { reason: state.endReason },
              },
              update: {},
            });
          },
          { timeout: 20_000 },
        );
        let savedTurns = turns.length,
          savedEvents = events.length;
        while (
          savedTurns < entry.turns.length ||
          savedEvents < entry.events.length
        ) {
          const lateTurns = entry.turns
            .slice(savedTurns)
            .map((turn) => ({ ...turn }));
          const lateEvents = entry.events.slice(savedEvents);
          await prisma.$transaction(
            async (tx) => {
              if (lateTurns.length)
                await tx.conversationTurn.createMany({
                  data: lateTurns,
                  skipDuplicates: true,
                });
              if (lateEvents.length)
                await tx.interviewEvent.createMany({
                  data: lateEvents,
                  skipDuplicates: true,
                });
            },
            { timeout: 20_000 },
          );
          savedTurns += lateTurns.length;
          savedEvents += lateEvents.length;
        }
        entry.persisted = true;
        entry.persistedAt = Date.now();
      });
      entry.state = state;
    })();
    try {
      await entry.flushing;
    } catch (error) {
      entry.flushing = undefined;
      throw error;
    }
  }

  evict(id: string) {
    const entry = this.peek(id);
    entry?.current?.controller.abort(turnCancelled());
    this.sessions.delete(id);
  }
  evictUser(userId: string) {
    for (const entry of this.forUser(userId)) this.evict(entry.interviewId);
  }
}

export const activeSessions = new ActiveSessionStore();
