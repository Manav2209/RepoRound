import { expect, mock, test } from "bun:test";

const livekit = await import("livekit-client");
type Listener = (...args: unknown[]) => void;
let room: FakeRoom;
class FakeRoom {
  readonly listeners = new Map<string, Listener>();
  constructor() {
    room = this;
  }
  on(event: string, listener: Listener) {
    this.listeners.set(event, listener);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.(...args);
  }
}
mock.module("livekit-client", () => ({
  Room: FakeRoom,
  RoomEvent: livekit.RoomEvent,
  Track: livekit.Track,
}));
const { createInterviewSession } = await import("./livekit");

test("agent state follows the participant argument in LiveKit attribute updates", () => {
  const states: string[] = [];
  createInterviewSession("ws://localhost:7880", "test", {
    onAgentState: (state) => states.push(state),
    onConnectionChange: () => {},
    onTranscript: () => {},
  });
  room.emit(
    livekit.RoomEvent.ParticipantAttributesChanged,
    { "lk.agent.state": "speaking" },
    { isAgent: true, attributes: { "lk.agent.state": "speaking" } },
  );
  room.emit(
    livekit.RoomEvent.ParticipantAttributesChanged,
    { "lk.agent.state": "listening" },
    { isAgent: true, attributes: { "lk.agent.state": "listening" } },
  );
  room.emit(
    livekit.RoomEvent.ParticipantAttributesChanged,
    { "lk.agent.state": "speaking" },
    { isAgent: false, attributes: { "lk.agent.state": "speaking" } },
  );
  expect(states).toEqual(["speaking", "listening"]);
});
