"use client";

import { COMPONENT_KINDS, COMPONENT_LABELS } from "./types";
import type { ComponentKind } from "../../types/interview";

export default function ComponentSidebar({
  onAdd,
  disabled,
}: {
  onAdd: (kind: ComponentKind) => void;
  disabled?: boolean;
}) {
  return (
    <aside className="design-sidebar" aria-label="Components">
      <h2>Components</h2>
      <p className="hint">Drag onto the canvas, or click to place.</p>
      <ul>
        {COMPONENT_KINDS.map((kind) => (
          <li key={kind}>
            <button
              type="button"
              className="component-chip"
              draggable={!disabled}
              disabled={disabled}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/component-kind", kind);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onAdd(kind)}
            >
              {COMPONENT_LABELS[kind]}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
