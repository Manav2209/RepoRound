import { expect, test } from "bun:test";
import { findOrderedPath, selectProbe, type ProbeContext } from "./probes.js";
import { getProblem } from "./problems.js";
import type {
  ComponentFact,
  EdgeFact,
  UpstreamFact,
} from "./graph.js";

const component = (
  componentId: string,
  kind: string,
  label = componentId,
): ComponentFact => ({ componentId, kind, label });

const edge = (
  edgeId: string,
  sourceId: string,
  sourceKind: string,
  targetId: string,
  targetKind: string,
): EdgeFact => ({ edgeId, sourceId, sourceKind, targetId, targetKind });

const notification = getProblem("notification-system")!;

function notifContext(overrides: Partial<ProbeContext> = {}): ProbeContext {
  const components = [
    component("api", "api_service", "API"),
    component("queue", "message_queue", "Queue"),
    component("worker", "worker", "Worker"),
    component("sms", "external_service", "SMS Provider"),
  ];
  const edges = [
    edge("e1", "api", "api_service", "queue", "message_queue"),
    edge("e2", "queue", "message_queue", "worker", "worker"),
    edge("e3", "worker", "worker", "sms", "external_service"),
  ];
  const upstreamByProvider: Record<string, UpstreamFact[]> = {
    sms: [
      { upstreamId: "api", upstreamLabel: "API" },
      { upstreamId: "queue", upstreamLabel: "Queue" },
      { upstreamId: "worker", upstreamLabel: "Worker" },
    ],
  };
  return {
    problem: notification,
    submissionId: "sub-1",
    revision: 1,
    components,
    edges,
    upstreamByProvider,
    askedProbeIds: [],
    ...overrides,
  };
}

test("ordered traversal finds an API -> Queue -> Worker path across intermediates", () => {
  const components = [
    component("api", "api_service"),
    component("cache", "cache"),
    component("queue", "message_queue"),
    component("worker", "worker"),
  ];
  const edges = [
    edge("e1", "api", "api_service", "cache", "cache"),
    edge("e2", "cache", "cache", "queue", "message_queue"),
    edge("e3", "queue", "message_queue", "worker", "worker"),
  ];
  const path = findOrderedPath(edges, components, [
    "api_service",
    "message_queue",
    "worker",
  ]);
  expect(path).toEqual(["api", "queue", "worker"]);
});

test("multi-hop traversal reaches the provider through the full async chain", () => {
  const probe = selectProbe(
    notifContext({ askedProbeIds: ["notif.async-buffer-ack"] }),
  );
  expect(probe.probeId).toBe("notif.provider-outage");
  expect(probe.graphPath[0]).toBe("sms");
  expect(probe.graphPath).toContain("api");
  expect(probe.graphPath).toContain("queue");
  expect(probe.graphPath).toContain("worker");
  expect(probe.referencedComponentIds).toContain("sms");
  expect(probe.revision).toBe(1);
  expect(probe.submissionId).toBe("sub-1");
});

test("altering an edge changes the deterministic probe choice", () => {
  const withQueue = selectProbe(notifContext());
  expect(withQueue.probeId).toBe("notif.async-buffer-ack");

  const withoutQueueEdge = selectProbe(
    notifContext({
      edges: [edge("e3", "worker", "worker", "sms", "external_service")],
    }),
  );
  expect(withoutQueueEdge.probeId).toBe("notif.provider-outage");
  expect(withoutQueueEdge.probeId).not.toBe(withQueue.probeId);
});

test("probe selection is deterministic and skips already asked probes", () => {
  const first = selectProbe(notifContext());
  const second = selectProbe(notifContext());
  expect(first).toEqual(second);

  const next = selectProbe(
    notifContext({
      askedProbeIds: ["notif.async-buffer-ack", "notif.provider-outage"],
    }),
  );
  expect(next.probeId).not.toBe("notif.async-buffer-ack");
  expect(next.probeId).not.toBe("notif.provider-outage");
});

test("a terminal provider node keeps its probe and never requires outdegree", () => {
  const probe = selectProbe(
    notifContext({ askedProbeIds: ["notif.async-buffer-ack"] }),
  );
  const provider = notifContext().components.find((c) => c.componentId === "sms")!;
  expect(provider.kind).toBe("external_service");
  expect(probe.referencedComponentIds).toContain("sms");
});
