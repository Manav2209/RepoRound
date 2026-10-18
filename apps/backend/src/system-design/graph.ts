import { FalkorDB } from "falkordb";
import type {
  ArchitectureSnapshot,
  ComponentKind,
} from "@repo/voice-types";

export interface InstallSubmissionInput {
  interviewId: string;
  submissionId: string;
  revision: number;
  snapshot: ArchitectureSnapshot;
}

export interface ComponentFact {
  componentId: string;
  kind: string;
  label: string;
}

export interface UpstreamFact {
  upstreamId: string;
  upstreamLabel: string;
}

export interface QueueWorkerFact {
  queueId: string;
  workerId: string;
}

export interface IsolatedFact {
  componentId: string;
  kind: string;
}

export interface EdgeFact {
  edgeId: string;
  sourceId: string;
  sourceKind: string;
  targetId: string;
  targetKind: string;
}

export interface VerifyInput {
  submissionId: string;
  revision: number;
  expectedNodes: number;
  expectedEdges: number;
}

export interface VerifyResult {
  nodeCount: number;
  edgeCount: number;
  crossSubmissionEdges: number;
}

/**
 * All graph reads are scoped by immutable `submissionId`. Deterministic probe
 * selection depends only on these facts, never on live canvas state.
 */
export interface DesignGraphStore {
  install(input: InstallSubmissionInput): Promise<void>;
  verify(input: VerifyInput): Promise<VerifyResult>;
  components(submissionId: string): Promise<ComponentFact[]>;
  upstreamPaths(input: {
    submissionId: string;
    providerId: string;
    maxHops: number;
  }): Promise<UpstreamFact[]>;
  queueWorkerPairs(submissionId: string): Promise<QueueWorkerFact[]>;
  edges(submissionId: string): Promise<EdgeFact[]>;
  isolatedComponents(submissionId: string): Promise<IsolatedFact[]>;
  removeSubmission(submissionId: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

type Row = Record<string, unknown>;

const READ_TIMEOUT_MS = 400;
const WRITE_TIMEOUT_MS = 5_000;

class FalkorDesignGraphStore implements DesignGraphStore {
  private client: FalkorDB | null = null;
  private connecting: Promise<FalkorDB> | null = null;

  constructor(
    private readonly options: {
      host: string;
      port: number;
      graph: string;
    },
  ) {}

  private async db(): Promise<FalkorDB> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = FalkorDB.connect({
        socket: { host: this.options.host, port: this.options.port },
      })
        .then((client: FalkorDB) => {
          this.client = client;
          return client;
        })
        .finally(() => {
          this.connecting = null;
        });
    }
    return this.connecting;
  }

  private async run(
    query: string,
    params: Record<string, unknown>,
    timeout: number,
  ): Promise<Row[]> {
    const db = await this.db();
    const graph = db.selectGraph(this.options.graph);
    try {
      const reply = await graph.query<Row>(query, {
        params: params as never,
        TIMEOUT: timeout,
      });
      return (reply.data as Row[] | undefined) ?? [];
    } catch (err) {
      // A dead connection must be re-established on the next call.
      this.reset();
      throw err;
    }
  }

  private reset(): void {
    const client = this.client;
    this.client = null;
    this.connecting = null;
    if (client) void client.close().catch(() => {});
  }

  async ping(): Promise<boolean> {
    try {
      await this.run("RETURN 1", {}, READ_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  async install(input: InstallSubmissionInput): Promise<void> {
    const { interviewId, submissionId, revision, snapshot } = input;
    await this.removeSubmission(submissionId);
    const nodes = snapshot.nodes.map((node) => ({
      componentId: node.id,
      kind: node.data.componentType,
      label: node.data.label,
    }));
    await this.run(
      `UNWIND $nodes AS row
       CREATE (n:DesignComponent {
         interviewId: $interviewId,
         submissionId: $submissionId,
         revision: $revision,
         componentId: row.componentId,
         kind: row.kind,
         label: row.label
       })`,
      { interviewId, submissionId, revision, nodes },
      WRITE_TIMEOUT_MS,
    );
    const edges = snapshot.edges.map((edge) => ({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
    }));
    await this.run(
      `UNWIND $edges AS row
       MATCH (s:DesignComponent {submissionId: $submissionId, componentId: row.source})
       MATCH (t:DesignComponent {submissionId: $submissionId, componentId: row.target})
       CREATE (s)-[:FLOWS_TO {submissionId: $submissionId, edgeId: row.edgeId}]->(t)`,
      { submissionId, edges },
      WRITE_TIMEOUT_MS,
    );
  }

  async verify(input: VerifyInput): Promise<VerifyResult> {
    const nodes = await this.scalar(
      `MATCH (n:DesignComponent {submissionId: $submissionId}) RETURN count(n) AS value`,
      { submissionId: input.submissionId },
    );
    const edges = await this.scalar(
      `MATCH (:DesignComponent {submissionId: $submissionId})-[r:FLOWS_TO {submissionId: $submissionId}]->(:DesignComponent {submissionId: $submissionId}) RETURN count(r) AS value`,
      { submissionId: input.submissionId },
    );
    const cross = await this.scalar(
      `MATCH (a:DesignComponent)-[r:FLOWS_TO {submissionId: $submissionId}]->(b:DesignComponent)
       WHERE a.submissionId <> $submissionId OR b.submissionId <> $submissionId
       RETURN count(r) AS value`,
      { submissionId: input.submissionId },
    );
    return {
      nodeCount: nodes,
      edgeCount: edges,
      crossSubmissionEdges: cross,
    };
  }

  async components(submissionId: string): Promise<ComponentFact[]> {
    const rows = await this.run(
      `MATCH (c:DesignComponent {submissionId: $submissionId})
       RETURN c.componentId AS componentId, c.kind AS kind, c.label AS label
       ORDER BY c.componentId`,
      { submissionId },
      READ_TIMEOUT_MS,
    );
    return rows.map((row) => ({
      componentId: String(row.componentId),
      kind: String(row.kind),
      label: String(row.label),
    }));
  }

  async upstreamPaths(input: {
    submissionId: string;
    providerId: string;
    maxHops: number;
  }): Promise<UpstreamFact[]> {
    const hops = Math.max(1, Math.min(5, Math.trunc(input.maxHops)));
    const rows = await this.run(
      `MATCH p = (source:DesignComponent {submissionId: $submissionId})
         -[:FLOWS_TO*1..${hops}]->
         (provider:DesignComponent {submissionId: $submissionId, componentId: $providerId})
       RETURN DISTINCT source.componentId AS upstreamId, source.label AS upstreamLabel
       LIMIT 30`,
      { submissionId: input.submissionId, providerId: input.providerId },
      READ_TIMEOUT_MS,
    );
    return rows.map((row) => ({
      upstreamId: String(row.upstreamId),
      upstreamLabel: String(row.upstreamLabel),
    }));
  }

  async queueWorkerPairs(submissionId: string): Promise<QueueWorkerFact[]> {
    const rows = await this.run(
      `MATCH (q:DesignComponent {submissionId: $submissionId, kind: $queueKind})
         -[:FLOWS_TO]->(w:DesignComponent {submissionId: $submissionId, kind: $workerKind})
       RETURN q.componentId AS queueId, w.componentId AS workerId`,
      { submissionId, queueKind: "message_queue", workerKind: "worker" },
      READ_TIMEOUT_MS,
    );
    return rows.map((row) => ({
      queueId: String(row.queueId),
      workerId: String(row.workerId),
    }));
  }

  async edges(submissionId: string): Promise<EdgeFact[]> {
    const rows = await this.run(
      `MATCH (s:DesignComponent {submissionId: $submissionId})
         -[r:FLOWS_TO {submissionId: $submissionId}]->
         (t:DesignComponent {submissionId: $submissionId})
       RETURN r.edgeId AS edgeId, s.componentId AS sourceId, s.kind AS sourceKind, t.componentId AS targetId, t.kind AS targetKind`,
      { submissionId },
      READ_TIMEOUT_MS,
    );
    return rows.map((row) => ({
      edgeId: String(row.edgeId),
      sourceId: String(row.sourceId),
      sourceKind: String(row.sourceKind),
      targetId: String(row.targetId),
      targetKind: String(row.targetKind),
    }));
  }

  async isolatedComponents(submissionId: string): Promise<IsolatedFact[]> {
    const rows = await this.run(
      `MATCH (c:DesignComponent {submissionId: $submissionId})
       WHERE NOT (c)-[:FLOWS_TO]-() AND NOT (c)<-[:FLOWS_TO]-()
       RETURN c.componentId AS componentId, c.kind AS kind`,
      { submissionId },
      READ_TIMEOUT_MS,
    );
    return rows.map((row) => ({
      componentId: String(row.componentId),
      kind: String(row.kind),
    }));
  }

  async removeSubmission(submissionId: string): Promise<void> {
    await this.run(
      `MATCH (n:DesignComponent {submissionId: $submissionId}) DETACH DELETE n`,
      { submissionId },
      WRITE_TIMEOUT_MS,
    );
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connecting = null;
    if (client) await client.close();
  }

  private async scalar(
    query: string,
    params: Record<string, unknown>,
  ): Promise<number> {
    const rows = await this.run(query, params, READ_TIMEOUT_MS);
    const value = rows[0]?.value;
    return typeof value === "number" ? value : Number(value ?? 0);
  }
}

let store: DesignGraphStore | null = null;
let graphOptions: { host: string; port: number; graph: string } | null = null;

export function createFalkorDesignGraphStore(options: {
  host: string;
  port: number;
  graph: string;
}): DesignGraphStore {
  return new FalkorDesignGraphStore(options);
}

export function configureDesignGraph(options: {
  host: string;
  port: number;
  graph: string;
}): void {
  graphOptions = options;
}

export function setDesignGraphStore(next: DesignGraphStore | null): void {
  store = next;
}

export function designGraphStore(): DesignGraphStore {
  if (!store) {
    if (!graphOptions)
      throw new Error("Design graph store is not configured");
    store = createFalkorDesignGraphStore(graphOptions);
  }
  return store;
}

export type { ComponentKind };
