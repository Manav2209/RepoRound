"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { COMPONENT_LABELS } from "./types";
import type { ArchitectureFlowNode } from "./types";

export default function ArchitectureNode({
  data,
  selected,
}: NodeProps<ArchitectureFlowNode>) {
  return (
    <div className={"arch-node" + (selected ? " selected" : "")}>
      <Handle type="target" position={Position.Left} />
      <span className="arch-node-kind">
        {COMPONENT_LABELS[data.componentType] ?? data.componentType}
      </span>
      <span className="arch-node-label">{data.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
