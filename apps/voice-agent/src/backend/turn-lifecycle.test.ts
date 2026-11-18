import { expect, test } from "bun:test";
import { TurnLifecycle, FinalizedTurnIds } from "./turn-lifecycle.js";

test("an amended SDK message receives a new operation ID while transport retries keep the same ID", () => {
  const ids = new FinalizedTurnIds();
  expect(ids.commit("message")).toBe("message");
  expect(ids.resolve("message")).toBe("message");
  expect(ids.commit("message")).toBe("message_r1");
  expect(ids.resolve("message")).toBe("message_r1");
  expect(ids.resolve("message")).toBe("message_r1");
  expect(ids.commit("other")).toBe("other");
});

test("unsaid generated questions stay staged and cancellation rolls back their turn", () => {
  const cancelled: string[] = [];
  const turns = new TurnLifecycle((id) => cancelled.push(id));
  const turn = turns.begin("t1");
  turns.stage(turn, "q2");
  turns.finish(turn);
  expect(turns.hasWork).toBe(true);
  turns.cancel();
  expect(cancelled).toEqual(["t1"]);
  expect(turns.speechStarted()).toBeUndefined();
});

test("heard questions become current and are not rolled back by later user speech", () => {
  const cancelled: string[] = [];
  const turns = new TurnLifecycle((id) => cancelled.push(id));
  const turn = turns.begin("t1");
  turns.stage(turn, "q2");
  turns.finish(turn);
  expect(turns.speechStarted()).toBe("q2");
  turns.cancel();
  expect(cancelled).toEqual([]);
  expect(turns.hasWork).toBe(false);
});

test("superseding a request aborts it and a late result cannot stage stale speech", () => {
  const cancelled: string[] = [];
  const turns = new TurnLifecycle((id) => cancelled.push(id));
  const old = turns.begin("old");
  const current = turns.begin("new");
  expect(old.controller.signal.aborted).toBe(true);
  expect(() => turns.stage(old, "stale")).toThrow();
  turns.finish(old);
  expect(turns.hasWork).toBe(true);
  turns.stage(current, "q2");
  expect(turns.speechStarted()).toBe("q2");
  expect(cancelled).toEqual(["old"]);
});
