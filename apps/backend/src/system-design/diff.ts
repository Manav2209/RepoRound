import type {
  ArchitectureEdgeRef,
  ArchitectureRevisionDiff,
  ArchitectureSnapshot,
} from "@repo/voice-types";

function nodeRef(node: ArchitectureSnapshot["nodes"][number]) {
  return {
    id: node.id,
    label: node.data.label,
    componentType: node.data.componentType,
  };
}

function edgeRef(edge: ArchitectureSnapshot["edges"][number]) {
  return { source: edge.source, target: edge.target };
}

function sortEdges(edges: ArchitectureEdgeRef[]): ArchitectureEdgeRef[] {
  return [...edges].sort(
    (a, b) =>
      a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );
}

/** Compares immutable snapshots without letting canvas positions imply a change. */
export function diffArchitectureSnapshots(
  previous: ArchitectureSnapshot,
  current: ArchitectureSnapshot,
  fromRevision: number,
  toRevision: number,
): ArchitectureRevisionDiff {
  const previousNodes = new Map(previous.nodes.map((n) => [n.id, n]));
  const currentNodeIds = new Set(current.nodes.map((n) => n.id));
  const addedNodes = current.nodes
    .filter((n) => !previousNodes.has(n.id))
    .map(nodeRef);
  const removedNodes = previous.nodes
    .filter((n) => !currentNodeIds.has(n.id))
    .map(nodeRef);
  const relabeled: ArchitectureRevisionDiff["nodes"]["relabeled"] = [];
  const retyped: ArchitectureRevisionDiff["nodes"]["retyped"] = [];
  for (const node of current.nodes) {
    const before = previousNodes.get(node.id);
    if (!before) continue;
    if (before.data.label !== node.data.label)
      relabeled.push({
        id: node.id,
        before: before.data.label,
        after: node.data.label,
      });
    if (before.data.componentType !== node.data.componentType)
      retyped.push({
        id: node.id,
        before: before.data.componentType,
        after: node.data.componentType,
      });
  }

  const previousEdges = new Map(previous.edges.map((e) => [e.id, e]));
  const currentEdgeIds = new Set(current.edges.map((e) => e.id));
  const addedEdges: ArchitectureEdgeRef[] = [];
  const removedEdges: ArchitectureEdgeRef[] = [];
  const reconnected: ArchitectureRevisionDiff["edges"]["reconnected"] = [];
  for (const edge of current.edges) {
    const before = previousEdges.get(edge.id);
    if (!before) {
      addedEdges.push(edgeRef(edge));
      continue;
    }
    if (before.source !== edge.source || before.target !== edge.target)
      reconnected.push({
        edgeId: edge.id,
        before: edgeRef(before),
        after: edgeRef(edge),
      });
  }
  for (const edge of previous.edges)
    if (!currentEdgeIds.has(edge.id)) removedEdges.push(edgeRef(edge));

  addedNodes.sort((a, b) => a.id.localeCompare(b.id));
  removedNodes.sort((a, b) => a.id.localeCompare(b.id));
  relabeled.sort((a, b) => a.id.localeCompare(b.id));
  retyped.sort((a, b) => a.id.localeCompare(b.id));
  reconnected.sort((a, b) => a.edgeId.localeCompare(b.edgeId));

  return {
    fromRevision,
    toRevision,
    nodes: { added: addedNodes, removed: removedNodes, relabeled, retyped },
    edges: {
      added: sortEdges(addedEdges),
      removed: sortEdges(removedEdges),
      reconnected,
    },
    material:
      addedNodes.length > 0 ||
      removedNodes.length > 0 ||
      relabeled.length > 0 ||
      retyped.length > 0 ||
      addedEdges.length > 0 ||
      removedEdges.length > 0 ||
      reconnected.length > 0,
  };
}
