"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DesignCanvas from "./DesignCanvas";
import { ApiError, getDesign, submitArchitecture } from "../../lib/api";
import type { ArchitectureSnapshot, DesignView } from "../../types/interview";

export default function DesignSubmission({
  interviewId,
  variant,
  onSubmitted,
}: {
  interviewId: string;
  variant: "initial" | "revision";
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const [design, setDesign] = useState<DesignView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const pendingRequest = useRef<{
    requestId: string;
    expectedRevision: number;
    snapshot: ArchitectureSnapshot;
  } | null>(null);
  const [submissionPending, setSubmissionPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const data = await getDesign(interviewId, controller.signal);
        if (cancelled) return;
        setDesign(data);
        setRemainingSeconds(data.remainingSeconds);
        setError(null);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          err instanceof ApiError && (err.status === 401 || err.status === 404)
            ? "This interview is not available on your account."
            : "We couldn't load the design problem. Please retry.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [interviewId, revision]);

  useEffect(() => {
    if (remainingSeconds === null || variant !== "initial") return;
    const timer = setTimeout(
      () => setRemainingSeconds((value) => Math.max(0, (value ?? 0) - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [remainingSeconds, variant]);

  async function handleSubmit(snapshot: ArchitectureSnapshot): Promise<void> {
    if (!design) return;
    setSubmitting(true);
    setError(null);
    pendingRequest.current ??= {
      requestId: crypto.randomUUID(),
      expectedRevision: design.activeRevision,
      snapshot: structuredClone(snapshot),
    };
    setSubmissionPending(true);
    try {
      await submitArchitecture(interviewId, pendingRequest.current);
      pendingRequest.current = null;
      setSubmissionPending(false);
      setSubmitting(false);
      if (variant === "initial") {
        router.push(`/interview/${interviewId}`);
      } else {
        onSubmitted?.();
        setRevision((n) => n + 1);
      }
    } catch (err) {
      setSubmitting(false);
      // Validation failures never reserve a revision. Ambiguous transport or
      // graph failures must replay the exact original request and snapshot.
      if (
        err instanceof ApiError &&
        (err.status === 400 || err.status === 422)
      ) {
        pendingRequest.current = null;
        setSubmissionPending(false);
      }
      setError(
        err instanceof ApiError && err.status === 409
          ? "A newer version of this design already exists."
          : err instanceof ApiError && err.status === 503
            ? "The submission could not be saved. Please try again."
            : "We couldn't submit your design. Please review it and try again.",
      );
    }
  }

  if (loading) return <p className="hint">Loading the design problem…</p>;

  if (!design || !design.problem)
    return (
      <p className="error" role="alert">
        {error ?? "The design problem is unavailable."}
      </p>
    );

  if (variant === "initial" && design.activeRevision >= 1)
    return (
      <section className="panel">
        <h2>You’ve submitted your design.</h2>
        <p className="hint">
          Your architecture is ready. Start the conversation to explain it.
        </p>
        <button
          type="button"
          onClick={() => router.push(`/interview/${interviewId}`)}
        >
          Continue to interview
        </button>
      </section>
    );

  if (variant === "revision" && !design.revisionAllowed)
    return (
      <p className="hint">
        The interviewer hasn’t asked for a revision yet. Keep explaining your
        design and they’ll challenge one part of it.
      </p>
    );

  return (
    <div className="design-submission">
      {variant === "initial" && (
        <section className="panel design-brief">
          <div className="section-heading">
            <h2>{design.problem.title}</h2>
            <span className="badge">{design.problem.difficulty}</span>
          </div>
          <p className="hint" role="timer">
            {remainingSeconds === null
              ? "Loading time remaining…"
              : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")} remaining for drawing and discussion`}
          </p>
          <p>{design.problem.brief}</p>
          <p className="hint">
            State any reasonable missing assumptions. You can use any architecture that meets the requirements.
          </p>
          {design.problem.visibleRequirements.length > 0 && (
            <ul className="requirement-list">
              {design.problem.visibleRequirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          )}
          <p className="hint">
            Assumption: {design.problem.loadAssumption}
          </p>
          {design.problem.constraints.length > 0 && (
            <ul className="requirement-list">
              {design.problem.constraints.map((constraint) => (
                <li key={constraint}>{constraint}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <DesignCanvas
        initialSnapshot={
          variant === "revision" ? (design.submission?.snapshot ?? null) : null
        }
        busy={submitting}
        editingDisabled={submissionPending}
        serverError={error}
        submitLabel={
          variant === "initial" ? "Submit design" : "Submit revision"
        }
        onSubmit={handleSubmit}
      />
    </div>
  );
}
