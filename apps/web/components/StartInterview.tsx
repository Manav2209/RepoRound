"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import GithubInput from "./GithubInput";
import {
  createSystemDesignInterview,
  getSystemDesignProblems,
} from "../lib/api";
import type { ProblemSummary, SystemDesignCatalog } from "../types/interview";

type Mode = "github" | "system_design";

export default function StartInterview() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("github");
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [roundDetails, setRoundDetails] = useState<Pick<
    SystemDesignCatalog,
    "durationMinutes" | "questionTarget"
  > | null>(null);
  const [problemId, setProblemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const selected = problems?.find((problem) => problem.id === problemId);

  useEffect(() => {
    if (mode !== "system_design" || problems) return;
    let cancelled = false;
    getSystemDesignProblems()
      .then((data) => {
        if (cancelled) return;
        setCatalogError(null);
        setRoundDetails({
          durationMinutes: data.durationMinutes,
          questionTarget: data.questionTarget,
        });
        setProblems(data.problems);
        setProblemId((current) => current ?? data.problems[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled)
          setCatalogError("We couldn't load the design problems.");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, problems, catalogAttempt]);

  async function startDesign(): Promise<void> {
    if (!selected || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const interview = await createSystemDesignInterview(selected.id);
      router.push(`/interview/${interview.interviewId}/design`);
    } catch {
      setError("We couldn't start this design interview. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="start-interview">
      <div
        className="mode-tabs practice-mode-tabs"
        role="tablist"
        aria-label="Interview type"
        onKeyDown={(event) => {
          if (
            submitting ||
            !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          )
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "github"
              : event.key === "End"
                ? "system_design"
                : mode === "github"
                  ? "system_design"
                  : "github";
          setMode(next);
          document.getElementById(`practice-mode-${next}`)?.focus();
        }}
      >
        <button
          id="practice-mode-github"
          type="button"
          role="tab"
          aria-controls="practice-panel-github"
          aria-selected={mode === "github"}
          tabIndex={mode === "github" ? 0 : -1}
          className={mode === "github" ? "active" : ""}
          onClick={() => setMode("github")}
          disabled={submitting}
        >
          <span className="mode-number" aria-hidden="true">
            01
          </span>
          <span>
            <strong>Your repository</strong>
            <small>Real code. Real engineering decisions.</small>
          </span>
        </button>
        <button
          id="practice-mode-system_design"
          type="button"
          role="tab"
          aria-controls="practice-panel-system_design"
          aria-selected={mode === "system_design"}
          tabIndex={mode === "system_design" ? 0 : -1}
          className={mode === "system_design" ? "active" : ""}
          onClick={() => setMode("system_design")}
          disabled={submitting}
        >
          <span className="mode-number" aria-hidden="true">
            02
          </span>
          <span>
            <strong>System design</strong>
            <small>A blank canvas. A problem worth solving.</small>
          </span>
        </button>
      </div>

      <div
        className="mode-panel"
        role="tabpanel"
        id={`practice-panel-${mode}`}
        aria-labelledby={`practice-mode-${mode}`}
      >
        {mode === "github" ? (
          <div className="repository-practice">
            <div>
              <p className="eyebrow">Start with what you have built</p>
              <h2>Put your project in the interview.</h2>
              <p className="practice-description">
                Share a public GitHub repository. We’ll read the code and ask
                about its architecture, implementation, and tradeoffs.
              </p>
              <GithubInput />
            </div>
            <aside
              className="practice-expectations"
              aria-label="What to expect"
            >
              <span className="badge">Voice interview</span>
              <h3>Your code sets the agenda.</h3>
              <ol>
                <li>We review your repository.</li>
                <li>You explain the technical decisions.</li>
                <li>You get feedback grounded in your answers.</li>
              </ol>
              <p className="hint">
                Have a microphone ready. You choose when to start after
                preparation.
              </p>
            </aside>
          </div>
        ) : (
          <div className="design-practice">
            <section
              className="design-catalog"
              aria-labelledby="design-catalog-title"
            >
              <div className="section-heading">
                <h2 id="design-catalog-title">Find your next challenge</h2>
                {problems && (
                  <span className="hint">{problems.length} problems</span>
                )}
              </div>
              <p className="practice-description">
                Choose a problem. Sketch your approach, then talk through how it
                holds up.
              </p>
              {roundDetails && (
                <p className="hint">
                  {roundDetails.durationMinutes} minutes, including drawing ·{" "}
                  {roundDetails.questionTarget} core questions
                </p>
              )}
              {catalogError ? (
                <div role="alert">
                  <p className="error">{catalogError}</p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setCatalogError(null);
                      setCatalogAttempt((attempt) => attempt + 1);
                    }}
                  >
                    Retry loading problems
                  </button>
                </div>
              ) : problems === null ? (
                <p className="hint" role="status">
                  Loading design problems…
                </p>
              ) : !problems.length ? (
                <p className="hint">
                  No design problems are available right now. Try a repository
                  interview instead.
                </p>
              ) : (
                <ul className="problem-list practice-problem-grid">
                  {problems.map((problem, index) => (
                    <li key={problem.id}>
                      <button
                        type="button"
                        className={`problem-option${problemId === problem.id ? " selected" : ""}`}
                        aria-pressed={problemId === problem.id}
                        disabled={submitting}
                        onClick={() => {
                          setProblemId(problem.id);
                          setError(null);
                        }}
                      >
                        <span className="problem-index" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span
                          className="problem-selected-mark"
                          aria-hidden="true"
                        >
                          {problemId === problem.id ? "✓" : ""}
                        </span>
                        <span className="problem-title">{problem.title}</span>
                        <span className="badge">{problem.difficulty}</span>
                        <span className="problem-brief">{problem.brief}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {selected && (
              <aside
                className="design-selection"
                aria-label="Selected practice problem"
              >
                <div
                  className="design-selection-content"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <p className="eyebrow">
                    {roundDetails
                      ? `${roundDetails.durationMinutes}-minute practice round`
                      : "Your practice round"}
                  </p>
                  <span className="badge">{selected.difficulty}</span>
                  <h3>{selected.title}</h3>
                  <p className="practice-description">{selected.brief}</p>
                  <ol className="practice-round-steps">
                    <li>Sketch your architecture</li>
                    <li>Explain the tradeoffs out loud</li>
                    <li>Review your feedback</li>
                  </ol>
                </div>
                <div className="design-launch">
                  <div className="design-launch-summary">
                    <span>
                      {roundDetails
                        ? `${roundDetails.durationMinutes} min · ${roundDetails.questionTarget} core questions`
                        : "Ready to practice"}
                    </span>
                    <strong>{selected.title}</strong>
                  </div>
                  {error && (
                    <p className="error" role="alert">
                      {error}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={startDesign}
                    disabled={submitting}
                    aria-label={`Start practice: ${selected.title}`}
                  >
                    {submitting ? "Setting up…" : "Start practice"}
                    <span aria-hidden="true">→</span>
                  </button>
                  <p className="hint design-launch-hint">
                    {roundDetails
                      ? `The ${roundDetails.durationMinutes}-minute timer includes drawing and discussion.`
                      : "Draw your architecture, then explain it out loud."}
                  </p>
                </div>
              </aside>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
