import { FalkorDB } from "falkordb";
import { prisma } from "@repo/db";
import { stateSchema } from "./schemas.js";
import { withInterviewLock, InterviewBusyError } from "./runtime-lock.js";
import type { MemoryFact } from "./memory-facts.js";

export interface MemoryGraphStore {
  replace(interviewId: string, facts: MemoryFact[]): Promise<void>;
  remove(interviewId: string): Promise<void>;
  close?(): Promise<void>;
}

class FalkorMemoryGraphStore implements MemoryGraphStore {
  private client: FalkorDB | null = null;
  private indexesReady = false;
  constructor(private readonly options: { host: string; port: number; graph: string }) {}

  private async query(query: string, params: Record<string, unknown>): Promise<void> {
    try {
      this.client ??= await FalkorDB.connect({ socket: { host: this.options.host, port: this.options.port } });
      await this.client.selectGraph(this.options.graph).query(query, {
        params: params as never,
        TIMEOUT: 2500,
      });
    } catch (error) {
      const client = this.client;
      this.client = null;
      if (client) void client.close().catch(() => {});
      throw error;
    }
  }

  async replace(interviewId: string, facts: MemoryFact[]): Promise<void> {
    if (!this.indexesReady) {
      for (const property of ["interviewId", "topic", "factId"] as const) {
        try {
          await this.query(`CREATE INDEX FOR (f:InterviewFact) ON (f.${property})`, {});
        } catch (error) {
          if (!/already (indexed|exists)/i.test(String(error))) throw error;
        }
      }
      this.indexesReady = true;
    }
    await this.remove(interviewId);
    if (!facts.length) return;
    await this.query(
      `UNWIND $facts AS row
       CREATE (fact:InterviewFact {
         interviewId: $interviewId, factId: row.id, sourceTurnId: row.sourceTurnId,
         questionId: row.questionId, objectiveId: row.objectiveId,
         topic: row.topic, text: row.text, observedAt: row.observedAt,
         provenance: row.provenance, confidence: row.confidence,
         verification: row.verification, probed: row.probed
       })
       MERGE (topic:MemoryTopic {
         interviewId: $interviewId, objectiveId: row.objectiveId, topic: row.topic
       })
       CREATE (fact)-[:ABOUT {interviewId: $interviewId}]->(topic)`,
      { interviewId, facts },
    );
  }

  async remove(interviewId: string): Promise<void> {
    await this.query(
      `MATCH (n {interviewId: $interviewId})
       WHERE n:InterviewFact OR n:MemoryTopic
       DETACH DELETE n`,
      { interviewId },
    );
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.close();
  }
}

let store: MemoryGraphStore | null = null;
let options: { host: string; port: number; graph: string } | null = null;
export function configureMemoryGraph(config: typeof options): void {
  options = config;
}
export function setMemoryGraphStore(next: MemoryGraphStore | null): void {
  store = next;
}
export function createFalkorMemoryGraphStore(config: NonNullable<typeof options>): MemoryGraphStore {
  return new FalkorMemoryGraphStore(config);
}
export function memoryGraphStore(): MemoryGraphStore {
  if (!store) {
    if (!options) throw new Error("Memory graph is not configured");
    store = new FalkorMemoryGraphStore(options);
  }
  return store;
}

/** PostgreSQL remains authoritative. A failed projection is left pending. */
export async function reconcileMemoryGraph(): Promise<void> {
  const pending = await prisma.$queryRaw<{ interviewId: string }[]>`
    SELECT "interviewId" FROM "InterviewMemoryProjection"
    WHERE "version" > "projectedVersion"
    ORDER BY "updatedAt" ASC LIMIT 20`;
  for (const row of pending) {
    try {
      await withInterviewLock(row.interviewId, async () => {
        if (await prisma.interviewCleanup.findUnique({ where: { interviewId: row.interviewId } })) return;
        const runtime = await prisma.interviewRuntime.findUnique({ where: { interviewId: row.interviewId } });
        if (!runtime) return;
        const facts = stateSchema.parse(runtime.data).memoryFacts ?? [];
        await memoryGraphStore().replace(row.interviewId, facts);
        await prisma.interviewMemoryProjection.updateMany({
          where: { interviewId: row.interviewId, version: runtime.version },
          data: { projectedVersion: runtime.version },
        });
      });
    } catch (error) {
      if (!(error instanceof InterviewBusyError))
        console.error("[memory-graph] projection retry pending", row.interviewId, error);
    }
  }
}
