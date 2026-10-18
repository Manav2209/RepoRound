import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let status = "disconnected";
mock.module("next/navigation", () => ({ useRouter: () => ({ push() {} }) }));
mock.module("../hooks/useInterviewSession", () => ({
  useInterviewSession: () => ({
    status,
    agentReady: false,
    readyTimedOut: false,
    transcript: [],
    isMuted: false,
    isAISpeaking: false,
    agentState: "unknown",
    mute() {},
    unmute() {},
    endInterview() {},
    reconnect() {},
    retry() {},
  }),
}));
const { default: InterviewRoom } = await import("../components/InterviewRoom");

test("a disconnected interview exposes a reconnect action", () => {
  status = "disconnected";
  const html = renderToStaticMarkup(<InterviewRoom interviewId="test" />);
  expect(html).toContain("Reconnect</button>");
  expect(html).not.toContain("Waiting for the interviewer to join");
});

test("a session that is still connecting keeps its waiting screen", () => {
  status = "connecting";
  const html = renderToStaticMarkup(<InterviewRoom interviewId="test" />);
  expect(html).toContain("Waiting for the interviewer to join");
  expect(html).not.toContain("Reconnect</button>");
});
