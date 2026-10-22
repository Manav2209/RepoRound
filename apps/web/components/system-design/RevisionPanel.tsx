"use client";

import { useEffect, useState } from "react";
import DesignSubmission from "./DesignSubmission";
import DesignCanvas from "./DesignCanvas";
import {
  ApiError,
  getDesign,
  resolveDesignCheckpoint,
} from "../../lib/api";
import type { DesignView } from "../../types/interview";

function secondsLabel(seconds: number): string {
  const clamped = Math.max(0, seconds);
  return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, "0")}`;
}

export default function RevisionPanel({
  interviewId,
}: {
  interviewId: string;
}) {
  const [design, setDesign] = useState<DesignView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const data = await getDesign(interviewId, controller.signal);
        if (cancelled) return;
        setDesign(data);
        setRemaining(data.remainingSeconds);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setUnavailable(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [interviewId]);

  useEffect(() => {
    if (unavailable) return;
    const timer = setInterval(async () => {
      try {
        const data = await getDesign(interviewId);
        setDesign(data);
        setRemaining(data.remainingSeconds);
      } catch {
        /* keep the last known state */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [unavailable, interviewId]);

  useEffect(() => {
    if (!design?.deadlineAt) return;
    const timer = setInterval(() => {
      setRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [design?.deadlineAt]);

  async function choose(choice: "CONTINUE" | "EDIT"): Promise<void> {
    if (!design?.checkpoint) return;
    setResolving(true);
    setError(null);
    try {
      await resolveDesignCheckpoint(
        interviewId,
        design.checkpoint.id,
        choice,
      );
      const data = await getDesign(interviewId);
      setDesign(data);
      setRemaining(data.remainingSeconds);
    } catch {
      setError("That choice could not be saved. Please try again.");
    } finally {
      setResolving(false);
    }
  }

  if (unavailable || !design) return null;
  if (design.phase === "FINISHED" || design.status === "completed") return null;

  const checkpoint = design.checkpoint;
  const editing = checkpoint?.status === "EDITING";
  const submitted = checkpoint?.status === "SUBMITTED";
  const awaiting = checkpoint?.status === "AWAITING_CHOICE";
  const finalEdit =
    checkpoint?.afterFailure === true ||
    design.phase === "FINAL_EDIT" ||
    (design.questionTarget > 0 && design.questionCount >= design.questionTarget);
  const diagram = design.submission ? (
    <DesignCanvas
      key={design.submission.submissionId}
      initialSnapshot={design.submission.snapshot}
      readOnly
      submitLabel=""
      onSubmit={() => {}}
    />
  ) : null;

  return (
    <section className="panel revision-panel" aria-live="polite">
      <div className="section-heading">
        <h2>Design checkpoint</h2>
        <span className="badge" aria-label="Time remaining">
          {secondsLabel(remaining)} remaining
        </span>
      </div>
      <p className="hint">
        Question {Math.min(design.questionCount, design.questionTarget)} of{" "}
        {design.questionTarget}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {editing ? (
        <>
          <p>
            Update the diagram, then submit it. The interviewer will continue
            automatically.
          </p>
          <DesignSubmission
            interviewId={interviewId}
            variant="revision"
            onSubmitted={() => {
              void getDesign(interviewId)
                .then((data) => {
                  setDesign(data);
                  setRemaining(data.remainingSeconds);
                })
                .catch(() => {});
            }}
          />
        </>
      ) : submitted ? (
        <>
          <h3>Revision submitted</h3>
          <p className="hint">
            The interviewer is preparing the next question.
          </p>
          {diagram}
        </>
      ) : awaiting ? (
        <>
          <p>
            {finalEdit
              ? "This was the final scenario. Make one last update, or finish the interview."
              : "You can revise your diagram now, or continue to the next question."}
          </p>
          <div className="revision-actions">
            <button
              type="button"
              disabled={resolving || remaining <= 0}
              onClick={() => void choose("EDIT")}
            >
              {finalEdit ? "Make final update" : "Update diagram"}
            </button>
            <button
              type="button"
              disabled={resolving || remaining <= 0}
              onClick={() => void choose("CONTINUE")}
            >
              {finalEdit ? "Finish interview" : "Continue"}
            </button>
          </div>
          {diagram}
        </>
      ) : (
        <>
          <p className="hint">
            {design.phase === "FAILURE"
              ? "Answer the final failure scenario, then you can make a last update."
              : "Keep explaining your design. After each answer, you can revise the diagram or continue."}
          </p>
          {diagram}
        </>
      )}
    </section>
  );
}
