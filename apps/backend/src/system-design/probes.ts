import type { ProblemConfig, SelectedProbe } from "@repo/voice-types";
import type {
  ComponentFact,
  DesignGraphStore,
  EdgeFact,
  UpstreamFact,
} from "./graph.js";

export interface ProbeContext {
  problem: ProblemConfig;
  submissionId: string;
  revision: number;
  components: ComponentFact[];
  edges: EdgeFact[];
  upstreamByProvider: Record<string, UpstreamFact[]>;
  askedProbeIds: string[];
}

const MAX_HOPS = 5;

function idOf(component: ComponentFact): string {
  return component.componentId;
}

function kinds(components: ComponentFact[], kind: string): ComponentFact[] {
  return components.filter((c) => c.kind === kind);
}

/**
 * Finds a directed path whose visited nodes match the requested kind sequence
 * in order, allowing unrelated intermediate nodes. Bounded and cycle-safe.
 */
export function findOrderedPath(
  edges: EdgeFact[],
  components: ComponentFact[],
  sequence: string[],
): string[] | null {
  if (!sequence.length) return null;
  const outgoing = new Map<string, EdgeFact[]>();
  for (const edge of edges) {
    if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
    outgoing.get(edge.sourceId)!.push(edge);
  }
  const kindById = new Map(components.map((c) => [idOf(c), c.kind]));

  const startKind = sequence[0]!;
  for (const start of components.filter((c) => c.kind === startKind)) {
    const visited = new Set<string>([idOf(start)]);
    const stack: Array<{ id: string; idx: number; depth: number; path: string[] }> =
      [{ id: idOf(start), idx: 0, depth: 0, path: [] }];
    while (stack.length) {
      const current = stack.pop()!;
      let idx = current.idx;
      const path = [...current.path];
      if (kindById.get(current.id) === sequence[idx]) {
        path.push(current.id);
        idx += 1;
        if (idx === sequence.length) return path;
      }
      if (current.depth >= MAX_HOPS) continue;
      for (const edge of outgoing.get(current.id) ?? []) {
        if (visited.has(edge.targetId)) continue;
        visited.add(edge.targetId);
        stack.push({
          id: edge.targetId,
          idx,
          depth: current.depth + 1,
          path,
        });
      }
    }
  }
  return null;
}

function labelFor(components: ComponentFact[], id: string): string {
  return components.find((c) => c.componentId === id)?.label ?? id;
}

/** Deterministic probe selection. Application policy, not an LLM tool loop. */
export function selectProbe(ctx: ProbeContext): SelectedProbe {
  const { problem, components, edges, askedProbeIds } = ctx;
  const asked = new Set(askedProbeIds);
  const build = (
    probeId: string,
    referenced: string[],
    graphPath: string[],
    reason: string,
  ): SelectedProbe => ({
    probeId,
    submissionId: ctx.submissionId,
    revision: ctx.revision,
    referencedComponentIds: referenced,
    graphPath,
    reason,
  });

  if (problem.id === "notification-system") {
    const asyncPath = findOrderedPath(edges, components, [
      "api_service",
      "message_queue",
      "worker",
    ]);
    if (asyncPath && !asked.has("notif.async-buffer-ack")) {
      return build(
        "notif.async-buffer-ack",
        asyncPath,
        asyncPath,
        "Submission contains an API -> queue -> worker path; ask about acknowledgments and retries.",
      );
    }
    const providerPath = findOrderedPath(edges, components, [
      "worker",
      "external_service",
    ]);
    if (providerPath && !asked.has("notif.provider-outage")) {
      const providerId = providerPath.at(-1)!;
      const upstream = ctx.upstreamByProvider[providerId] ?? [];
      const path = [providerId, ...upstream.map((u) => u.upstreamId)];
      return build(
        "notif.provider-outage",
        [providerId, ...upstream.map((u) => u.upstreamId)],
        path,
        "Submission routes work to an external provider; ask about provider failure and pending messages.",
      );
    }
    if (
      !kinds(components, "message_queue").length &&
      !asked.has("notif.request-latency")
    ) {
      return build(
        "notif.request-latency",
        kinds(components, "api_service").map(idOf),
        [],
        "No asynchronous buffer is visible; ask about request latency and slow providers.",
      );
    }
    if (edges.length > 0 && !asked.has("notif.arrow-direction")) {
      return build(
        "notif.arrow-direction",
        edges.flatMap((e) => [e.sourceId, e.targetId]).slice(0, 4),
        [],
        "Topology is not a recognizable notification flow; ask the candidate to explain arrow direction.",
      );
    }
    if (!asked.has("notif.scaling-fallback"))
      return build(
        "notif.scaling-fallback",
        [],
        [],
        "Graph is minimal; ask a general scaling question without claiming topology facts.",
      );
    return build("notif.generic", [], [], "General fallback question.");
  }

  const asyncPath = findOrderedPath(edges, components, [
    "api_service",
    "message_queue",
    "worker",
  ]);
  if (asyncPath && !asked.has("generic.async"))
    return build(
      "generic.async",
      asyncPath,
      asyncPath,
      "Submission contains an asynchronous worker path; ask about its guarantees.",
    );
  const dbPath = findOrderedPath(edges, components, ["api_service", "database"]);
  if (dbPath && !asked.has("generic.data-consistency"))
    return build(
      "generic.data-consistency",
      dbPath,
      dbPath,
      "Submission connects an API to a datastore; ask about data modeling and consistency.",
    );
  const providerPath = findOrderedPath(edges, components, [
    "worker",
    "external_service",
  ]);
  if (providerPath && !asked.has("generic.third-party"))
    return build(
      "generic.third-party",
      providerPath,
      providerPath,
      "Submission depends on an external service; ask about third-party failure.",
    );
  return build("generic.scaling-fallback", [], [], "General scaling fallback.");
}

export async function gatherProbeContext(input: {
  problem: ProblemConfig;
  submissionId: string;
  revision: number;
  store: DesignGraphStore;
  askedProbeIds: string[];
}): Promise<ProbeContext> {
  const components = await input.store.components(input.submissionId);
  const edges = await input.store.edges(input.submissionId);
  const upstreamByProvider: Record<string, UpstreamFact[]> = {};
  for (const provider of components.filter(
    (c) => c.kind === "external_service",
  )) {
    upstreamByProvider[provider.componentId] = await input.store.upstreamPaths({
      submissionId: input.submissionId,
      providerId: provider.componentId,
      maxHops: MAX_HOPS,
    });
  }
  return {
    problem: input.problem,
    submissionId: input.submissionId,
    revision: input.revision,
    components,
    edges,
    upstreamByProvider,
    askedProbeIds: input.askedProbeIds,
  };
}

export { labelFor };
