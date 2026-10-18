import type { Edge, Node } from "@xyflow/react";
import type { ComponentKind } from "../../types/interview";

export type ArchitectureNodeData = {
  componentType: ComponentKind;
  label: string;
};

export type ArchitectureFlowNode = Node<ArchitectureNodeData, "architecture">;
export type ArchitectureFlowEdge = Edge;

export const COMPONENT_KINDS: ComponentKind[] = [
  "client",
  "load_balancer",
  "api_service",
  "database",
  "cache",
  "message_queue",
  "worker",
  "object_storage",
  "external_service",
  "cdn",
];

export const COMPONENT_LABELS: Record<ComponentKind, string> = {
  client: "Client",
  load_balancer: "Load Balancer",
  api_service: "API / Service",
  database: "Database",
  cache: "Cache",
  message_queue: "Message Queue",
  worker: "Worker",
  object_storage: "Object Storage",
  external_service: "External Service",
  cdn: "CDN",
};

export const MAX_NODES = 75;
export const MAX_EDGES = 150;
export const MAX_LABEL_LENGTH = 80;
