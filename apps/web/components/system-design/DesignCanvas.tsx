"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ArchitectureNode from "./ArchitectureNode";
import ComponentSidebar from "./ComponentSidebar";
import {
  COMPONENT_LABELS,
  MAX_EDGES,
  MAX_LABEL_LENGTH,
  MAX_NODES,
  type ArchitectureFlowEdge,
  type ArchitectureFlowNode,
} from "./types";
import type {
  ArchitectureSnapshot,
  ComponentKind,
} from "../../types/interview";

const nodeTypes = { architecture: ArchitectureNode };

function toFlow(snapshot: ArchitectureSnapshot | null | undefined): {
  nodes: ArchitectureFlowNode[];
  edges: ArchitectureFlowEdge[];
} {
  if (!snapshot) return { nodes: [], edges: [] };
  return {
    nodes: snapshot.nodes.map((n) => ({
      id: n.id,
      type: "architecture" as const,
      position: { x: n.position.x, y: n.position.y },
      data: { componentType: n.data.componentType, label: n.data.label },
    })),
    edges: snapshot.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      markerEnd: { type: MarkerType.ArrowClosed },
    })),
  };
}

function newId(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${uuid.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

function validate(
  nodes: ArchitectureFlowNode[],
  edges: ArchitectureFlowEdge[],
): string | null {
  if (nodes.length < 2) return "Add at least two components.";
  if (edges.length < 1) return "Connect at least two components with an arrow.";
  if (nodes.length > MAX_NODES)
    return `At most ${MAX_NODES} components are allowed.`;
  if (edges.length > MAX_EDGES)
    return `At most ${MAX_EDGES} connections are allowed.`;
  const ids = new Set(nodes.map((n) => n.id));
  const pairs = new Set<string>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      return "Every arrow must connect two existing components.";
    if (edge.source === edge.target)
      return "An arrow cannot point at its own component.";
    const pair = `${edge.source}->${edge.target}`;
    if (pairs.has(pair))
      return "Duplicate arrows between the same two components are not allowed.";
    pairs.add(pair);
  }
  for (const node of nodes)
    if (node.data.label.length > MAX_LABEL_LENGTH)
      return `Component names must be ${MAX_LABEL_LENGTH} characters or fewer.`;
  return null;
}

function CanvasInner({
  initialSnapshot,
  readOnly,
  busy,
  editingDisabled,
  serverError,
  submitLabel,
  onSubmit,
}: {
  initialSnapshot: ArchitectureSnapshot | null;
  readOnly?: boolean;
  busy?: boolean;
  editingDisabled?: boolean;
  serverError?: string | null;
  submitLabel: string;
  onSubmit: (snapshot: ArchitectureSnapshot) => void | Promise<void>;
}) {
  const initial = useMemo(() => toFlow(initialSnapshot), [initialSnapshot]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ArchitectureFlowNode>(
    initial.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const counter = useRef(0);
  const canEdit = !readOnly && !busy && !editingDisabled;

  const addNode = useCallback(
    (kind: ComponentKind, position?: { x: number; y: number }) => {
      setNodes((current) => {
        if (current.length >= MAX_NODES) return current;
        counter.current += 1;
        const node: ArchitectureFlowNode = {
          id: newId("n"),
          type: "architecture",
          position: position ?? {
            x: 80 + ((current.length * 60) % 480),
            y: 60 + ((current.length * 50) % 360),
          },
          data: {
            componentType: kind,
            label: COMPONENT_LABELS[kind],
          },
        };
        return [...current, node];
      });
    },
    [setNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!canEdit || !connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      setEdges((current) => {
        if (current.length >= MAX_EDGES) return current;
        const exists = current.some(
          (e) =>
            e.source === connection.source && e.target === connection.target,
        );
        if (exists) return current;
        return addEdge(
          {
            ...connection,
            id: newId("e"),
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          current,
        );
      });
    },
    [canEdit, setEdges],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!canEdit) return;
      const kind = event.dataTransfer.getData(
        "application/component-kind",
      ) as ComponentKind;
      if (!kind) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNode(kind, position);
    },
    [addNode, canEdit, screenToFlowPosition],
  );

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  function updateSelectedLabel(label: string): void {
    setNodes((current) =>
      current.map((n) =>
        n.id === selectedId ? { ...n, data: { ...n.data, label } } : n,
      ),
    );
  }

  function deleteSelected(): void {
    setNodes((current) => current.filter((n) => n.id !== selectedId));
    setEdges((current) =>
      current.filter((e) => e.source !== selectedId && e.target !== selectedId),
    );
    setSelectedId(null);
  }

  function buildSnapshot(): ArchitectureSnapshot {
    return {
      schemaVersion: 1,
      nodes: nodes.map((n) => ({
        id: n.id,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        data: {
          componentType: n.data.componentType,
          label: n.data.label.trim() || COMPONENT_LABELS[n.data.componentType],
        },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
    };
  }

  async function handleSubmit(): Promise<void> {
    const problem = validate(nodes, edges);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    await onSubmit(buildSnapshot());
  }

  return (
    <div
      className={"design-layout" + (readOnly ? " design-layout-readonly" : "")}
    >
      {!readOnly && (
        <ComponentSidebar onAdd={(kind) => addNode(kind)} disabled={!canEdit} />
      )}
      <div className="design-main">
        <div
          className="design-canvas"
          ref={wrapper}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <ReactFlow<ArchitectureFlowNode, ArchitectureFlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            connectionMode={ConnectionMode.Loose}
            elementsSelectable={canEdit}
            deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
            fitView
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {selectedNode && canEdit && (
          <div className="design-inspector">
            <label htmlFor="component-label">Component name</label>
            <input
              id="component-label"
              value={selectedNode.data.label}
              maxLength={MAX_LABEL_LENGTH}
              onChange={(e) => updateSelectedLabel(e.target.value)}
            />
            <span className="hint">
              {
                COMPONENT_LABELS[
                  selectedNode.data.componentType as ComponentKind
                ]
              }
            </span>
            <button
              type="button"
              className="secondary"
              onClick={deleteSelected}
            >
              Delete component
            </button>
          </div>
        )}
      </div>
      <div className="design-actions">
        <p className="hint">
          {nodes.length} components · {edges.length} connections
        </p>
        {!readOnly && (
          <div>
            {(localError || serverError) && (
              <p className="error" role="alert">
                {localError ?? serverError}
              </p>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={readOnly || busy}
            >
              {busy ? "Submitting..." : submitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DesignCanvas(props: {
  initialSnapshot: ArchitectureSnapshot | null;
  readOnly?: boolean;
  busy?: boolean;
  editingDisabled?: boolean;
  serverError?: string | null;
  submitLabel: string;
  onSubmit: (snapshot: ArchitectureSnapshot) => void | Promise<void>;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
