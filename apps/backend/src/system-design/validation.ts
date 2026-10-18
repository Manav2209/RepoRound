import { z } from "zod";
import {
  COMPONENT_KINDS,
  type ArchitectureSnapshot,
} from "@repo/voice-types";

export const MAX_NODES = 75;
export const MAX_EDGES = 150;
export const MAX_LABEL_LENGTH = 80;
const COORD_BOUND = 100_000;
const opaqueId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "IDs must be opaque and sanitized");

export const componentKindSchema = z.enum(
  COMPONENT_KINDS as unknown as [string, ...string[]],
);

export const architectureNodeSchema = z.object({
  id: opaqueId,
  position: z.object({
    x: z.number().finite().min(-COORD_BOUND).max(COORD_BOUND),
    y: z.number().finite().min(-COORD_BOUND).max(COORD_BOUND),
  }),
  data: z.object({
    componentType: componentKindSchema,
    label: z.string().trim().min(1).max(MAX_LABEL_LENGTH),
  }),
});

export const architectureEdgeSchema = z.object({
  id: opaqueId,
  source: opaqueId,
  target: opaqueId,
});

export const architectureSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(architectureNodeSchema).min(2).max(MAX_NODES),
    edges: z.array(architectureEdgeSchema).min(1).max(MAX_EDGES),
  })
  .superRefine((snapshot, ctx) => {
    const nodeIds = new Set<string>();
    for (const node of snapshot.nodes) {
      if (nodeIds.has(node.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate node id "${node.id}"`,
          path: ["nodes"],
        });
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    const pairs = new Set<string>();
    for (const edge of snapshot.edges) {
      if (edgeIds.has(edge.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate edge id "${edge.id}"`,
          path: ["edges"],
        });
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge "${edge.id}" references a missing component`,
          path: ["edges"],
        });
      if (edge.source === edge.target)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge "${edge.id}" is a self-loop`,
          path: ["edges"],
        });
      const pair = `${edge.source}->${edge.target}`;
      if (pairs.has(pair))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate edge between "${edge.source}" and "${edge.target}"`,
          path: ["edges"],
        });
      pairs.add(pair);
    }
  });

export const submitArchitectureRequestSchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(1),
  snapshot: architectureSnapshotSchema,
});

export type ParsedSubmitArchitectureRequest = z.infer<
  typeof submitArchitectureRequestSchema
>;

/**
 * Produces the canonical stored snapshot. The Zod parse strips unknown
 * UI-only fields (selection flags, drag state) before persistence.
 */
export function normalizeSnapshot(input: unknown): ArchitectureSnapshot {
  const parsed = architectureSnapshotSchema.parse(input);
  return {
    schemaVersion: 1,
    nodes: parsed.nodes.map((node) => ({
      id: node.id,
      position: { x: node.position.x, y: node.position.y },
      data: {
        componentType: node.data.componentType as ArchitectureSnapshot["nodes"][number]["data"]["componentType"],
        label: node.data.label,
      },
    })),
    edges: parsed.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
  };
}
