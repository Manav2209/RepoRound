"use client";

import { useEffect, useState } from "react";
import DesignSubmission from "./DesignSubmission";
import DesignCanvas from "./DesignCanvas";
import { ApiError, getDesign } from "../../lib/api";
import type { DesignView } from "../../types/interview";

export default function RevisionPanel({
  interviewId,
}: {
  interviewId: string;
}) {
  const [design, setDesign] = useState<DesignView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const data = await getDesign(interviewId, controller.signal);
        if (!cancelled) setDesign(data);
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
    if (unavailable || open || (design?.activeRevision ?? 0) >= 2) return;
    const timer = setInterval(async () => {
      try {
        const data = await getDesign(interviewId);
        setDesign(data);
      } catch {
        /* keep the last known state */
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [unavailable, open, design?.activeRevision, interviewId]);

  if (unavailable || !design) return null;

  const diagram = design.submission ? (
    <DesignCanvas
      key={design.submission.submissionId}
      initialSnapshot={design.submission.snapshot}
      readOnly
      submitLabel=""
      onSubmit={() => {}}
    />
  ) : null;

  if (submitted || design.activeRevision >= 2)
    return (
      <section className="panel revision-panel" aria-live="polite">
        <h2>Revision submitted</h2>
        <p className="hint">
          Explain what you changed — the interviewer will follow up on it.
        </p>
        {design.activeRevision >= 2 ? (
          diagram
        ) : (
          <p className="hint">Loading your revised design…</p>
        )}
      </section>
    );

  if (!design.revisionAllowed)
    return (
      <section className="panel revision-panel">
        <h2>Your submitted design</h2>
        <p className="hint">
          The interviewer will challenge one part of your architecture. Keep
          explaining your choices.
        </p>
        {diagram}
      </section>
    );

  return (
    <section className="panel revision-panel">
      <div className="section-heading">
        <h2>Revise your design</h2>
        <span className="badge">Challenge</span>
      </div>
      {!open ? (
        <>
          <p>
            The interviewer asked you to change one part of your design. Open
            the editor to update it, then submit the revision.
          </p>
          <button type="button" onClick={() => setOpen(true)}>
            Open editor
          </button>
          {diagram}
        </>
      ) : (
        <DesignSubmission
          interviewId={interviewId}
          variant="revision"
          onSubmitted={() => {
            setOpen(false);
            setSubmitted(true);
            void getDesign(interviewId)
              .then(setDesign)
              .catch(() => {});
          }}
        />
      )}
    </section>
  );
}
