import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let status = "disconnected";
let resumePolicy: "restart" | "resume" = "resume";
mock.module("next/navigation", () => ({ useRouter: () => ({ push() {} }) }));
mock.module("../hooks/useInterviewSession", () => ({
  useInterviewSession: () => ({
    status,
    resumePolicy,
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
  resumePolicy = "resume";
  status = "disconnected";
  const html = renderToStaticMarkup(<InterviewRoom interviewId="test" />);
  expect(html).toContain("Reconnect</button>");
  expect(html).not.toContain("Waiting for the interviewer to join");
});

test("a session that is still connecting keeps its waiting screen", () => {
  resumePolicy = "resume";
  status = "connecting";
  const html = renderToStaticMarkup(<InterviewRoom interviewId="test" />);
  expect(html).toContain("Waiting for the interviewer to join");
  expect(html).not.toContain("Reconnect</button>");
});

test("a non-resumable repository interview offers a fresh practice session", () => {
  status = "disconnected";
  resumePolicy = "restart";
  const html = renderToStaticMarkup(<InterviewRoom interviewId="test" />);
  expect(html).toContain("Start new interview");
  expect(html).toContain('href="/practice"');
  expect(html).not.toContain("Reconnect</button>");
  expect(html).not.toContain("resume your session");
});
