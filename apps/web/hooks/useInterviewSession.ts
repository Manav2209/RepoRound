"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus, TranscriptMessage } from "../types/interview";
import type { AgentSpeakingState, InterviewSession } from "../lib/livekit";
import { createInterviewSession } from "../lib/livekit";
import {
  endInterview,
  startSession,
  getTranscript,
  getInterview,
} from "../lib/api";
import { useRouter } from "next/navigation";

export interface UseInterviewSessionResult {
  status: ConnectionStatus;
  transcript: TranscriptMessage[];
  isMuted: boolean;
  isAISpeaking: boolean;
  agentState: AgentSpeakingState;
  agentReady: boolean;
  readyTimedOut: boolean;
  mute: () => Promise<void>;
  unmute: () => Promise<void>;
  endInterview: () => Promise<void>;
  reconnect: () => void;
  retry: () => void;
}

const AGENT_READY_TIMEOUT_MS = 30_000;

export function useInterviewSession(
  interviewId: string,
): UseInterviewSessionResult {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [agentState, setAgentState] = useState<AgentSpeakingState>("unknown");
  const [readyTimedOut, setReadyTimedOut] = useState(false);
  const sessionRef = useRef<InterviewSession | null>(null);
  const transcriptRef = useRef<TranscriptMessage[]>([]);
  const router = useRouter();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let polling = false;
    let finished = false;
    const poll = async () => {
      if (cancelled || polling || finished) return;
      polling = true;
      try {
        const interview = await getInterview(interviewId);
        if (cancelled) return;
        if (
          ["completing", "completed", "evaluation_failed"].includes(
            interview.status,
          )
        ) {
          finished = true;
          await sessionRef.current?.disconnect();
          router.replace(`/interview/${interviewId}/result`);
          return;
        }
        const saved = await getTranscript(interviewId);
        if (cancelled) return;
        // Server turns replace ephemeral LiveKit segments once persisted.
        transcriptRef.current = saved;
        setTranscript(saved);
      } catch {
        /* temporary API loss must not close the voice connection */
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, 3000);

    async function init(): Promise<void> {
      try {
        setStatus("connecting");
        await poll();
        if (cancelled || finished) return;
        const session = await startSession(interviewId);

        if (cancelled) return;
        sessionRef.current = createInterviewSession(
          session.serverUrl,
          session.token,
          {
            onTranscript: (msg) => {
              const existingIdx = transcriptRef.current.findIndex(
                (m) => m.id === msg.id,
              );
              let next: TranscriptMessage[];
              if (existingIdx >= 0) {
                next = transcriptRef.current.slice();
                next[existingIdx] = { ...next[existingIdx], ...msg };
              } else {
                next = [...transcriptRef.current, msg];
              }
              transcriptRef.current = next;
              if (!cancelled) setTranscript(next);
            },
            onConnectionChange: (s) => {
              if (cancelled) return;
              setStatus(s as ConnectionStatus);
              if (s === "disconnected") {
                setAgentState("unknown");
              }
            },
            onAgentState: (s) => {
              if (!cancelled) setAgentState(s);
            },
          },
        );

        await sessionRef.current.connect();
      } catch (err) {
        if (!cancelled) {
          setStatus("failed");
          console.error("interview session failed", err);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
      clearInterval(timer);
      void sessionRef.current?.disconnect().catch(() => {});
    };
  }, [interviewId, router, revision]);

  useEffect(() => {
    if (readyTimedOut || agentState !== "unknown") return;
    if (status !== "connecting" && status !== "connected") return;
    const timer = setTimeout(() => {
      setReadyTimedOut(true);
      void sessionRef.current?.disconnect().catch(() => {});
    }, AGENT_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [readyTimedOut, agentState, status]);

  const isAISpeaking = agentState === "speaking";

  return {
    status,
    transcript,
    isMuted,
    isAISpeaking,
    agentState,
    agentReady: status === "connected" && agentState !== "unknown",
    readyTimedOut,
    reconnect: () => setRevision((n) => n + 1),
    retry: () => {
      setReadyTimedOut(false);
      setAgentState("unknown");
      setRevision((n) => n + 1);
    },
    mute: async () => {
      await sessionRef.current?.mute();
      setIsMuted(true);
    },
    unmute: async () => {
      await sessionRef.current?.unmute();
      setIsMuted(false);
    },
    endInterview: async () => {
      await sessionRef.current?.disconnect();
      await endInterview(interviewId);
    },
  };
}
