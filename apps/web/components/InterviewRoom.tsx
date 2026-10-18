"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInterviewSession } from "../hooks/useInterviewSession";
import ConnectionStatus from "./ConnectionStatus";
import Transcript from "./Transcript";
import MicrophoneButton from "./MicrophoneButton";
import RevisionPanel from "./system-design/RevisionPanel";

export default function InterviewRoom({
  interviewId,
}: {
  interviewId: string;
}) {
  const router = useRouter();
  const {
    status,
    transcript,
    isMuted,
    isAISpeaking,
    agentState,
    agentReady,
    readyTimedOut,
    mute,
    unmute,
    endInterview,
    reconnect,
    retry,
  } = useInterviewSession(interviewId);

  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnd(): Promise<void> {
    setEnding(true);
    setError(null);
    try {
      await endInterview();
      router.push(`/interview/${interviewId}/result`);
    } catch {
      setEnding(false);
      setError(
        "Unable to end the interview. Check your connection and try again.",
      );
    }
  }

  if (!agentReady) {
    const disconnected = status === "disconnected";
    const unavailable = readyTimedOut || status === "failed" || disconnected;
    return (
      <div className="interview-room">
        <Link href="/" className="back-link">
          ← Back to home
        </Link>
        {unavailable ? (
          <>
            <p className="eyebrow">Interviewer unavailable</p>
            <h1>The interviewer isn’t available right now.</h1>
            <p className="subtitle">
              The connection to your interviewer is unavailable. Reconnect to
              resume your session.
            </p>
            <div className="preparation-actions">
              <button type="button" onClick={retry}>
                {disconnected ? "Reconnect" : "Try again"}
              </button>
              <Link href="/" className="secondary">
                Back to home
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">Live interview</p>
            <h1>Connecting you to your interviewer…</h1>
            <p className="subtitle">
              Please wait a moment. The interview starts as soon as your
              interviewer joins the room.
            </p>
            <p className="hint">
              <span className="loader" aria-hidden="true" /> Waiting for the
              interviewer to join
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="interview-room">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Live interview</p>
          <h1>Talk through your project.</h1>
          <p className="subtitle">
            Explain your thinking. Take a moment when you need it.
          </p>
        </div>
      </div>
      <section className="panel voice-panel" aria-label="Voice connection">
        <div className="avatar">
          <div className="avatar-circle" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
            </svg>
          </div>
          <div>
            <h2>Your interviewer</h2>
            <ConnectionStatus
              status={status}
              agentState={agentState}
              isAISpeaking={isAISpeaking}
            />
          </div>
        </div>
        <div
          className={"voice-wave" + (isAISpeaking ? " speaking" : "")}
          aria-hidden="true"
        >
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      </section>
      <RevisionPanel interviewId={interviewId} />
      <section>
        <div className="transcript-heading">
          <h2>Conversation</h2>
          <span className="badge">Live transcript</span>
        </div>
        <Transcript messages={transcript} />
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="controls">
        {(status === "disconnected" || status === "failed") && (
          <button type="button" onClick={reconnect}>
            Reconnect
          </button>
        )}
        <MicrophoneButton
          isMuted={isMuted}
          onToggle={isMuted ? unmute : mute}
          disabled={status !== "connected"}
        />
        <button
          type="button"
          className="end-button"
          onClick={handleEnd}
          disabled={ending}
        >
          {ending ? "Ending..." : "End Interview"}
        </button>
      </div>
      <p className="hint room-hint">
        Your microphone is {isMuted ? "muted" : "on"}. You can interrupt the
        interviewer by speaking.
      </p>
    </div>
  );
}
