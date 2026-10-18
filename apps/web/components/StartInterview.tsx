"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import GithubInput from "./GithubInput";
import {
  createSystemDesignInterview,
  getSystemDesignProblems,
} from "../lib/api";
import type { ProblemSummary } from "../types/interview";

type Mode = "github" | "system_design";

export default function StartInterview() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("github");
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [problemId, setProblemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode !== "system_design" || problems) return;
    let cancelled = false;
    getSystemDesignProblems()
      .then((data) => {
        if (cancelled) return;
        setCatalogError(null);
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
    if (!problemId) {
      setError("Choose a design problem to begin.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const interview = await createSystemDesignInterview(problemId);
      router.push(`/interview/${interview.interviewId}/design`);
    } catch {
      setError("We couldn't start this design interview. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="start-interview">
      <div className="mode-tabs" role="tablist" aria-label="Interview type">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "github"}
          className={mode === "github" ? "active" : ""}
          onClick={() => setMode("github")}
        >
          Project code review
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "system_design"}
          className={mode === "system_design" ? "active" : ""}
          onClick={() => setMode("system_design")}
        >
          System design
        </button>
      </div>

      <div className="mode-panel">
        {mode === "github" ? (
          <>
            <div className="section-heading">
              <h2>Start with your repository</h2>
              <span className="badge">Public GitHub repo</span>
            </div>
            <GithubInput />
            <p className="hint">
              You’ll need a microphone. Your interview starts after we prepare
              the questions.
            </p>
          </>
        ) : (
          <>
            <div className="section-heading">
              <h2>Choose a system design problem</h2>
              <span className="badge">Whiteboard</span>
            </div>
            {catalogError ? (
              <div>
                <p className="error" role="alert">
                  {catalogError}
                </p>
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
              <p className="hint">Loading design problems…</p>
            ) : (
              <ul className="problem-list">
                {problems.map((problem) => (
                  <li key={problem.id}>
                    <button
                      type="button"
                      className={
                        "problem-option" +
                        (problemId === problem.id ? " selected" : "")
                      }
                      aria-pressed={problemId === problem.id}
                      onClick={() => {
                        setProblemId(problem.id);
                        setError(null);
                      }}
                    >
                      <span className="problem-title">{problem.title}</span>
                      <span className="badge">{problem.difficulty}</span>
                      <span className="problem-brief">{problem.brief}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={startDesign}
              disabled={submitting || !problemId}
            >
              {submitting ? "Setting up..." : "Design this system"}
            </button>
            <p className="hint">
              You’ll draw the architecture, then explain your choices out loud.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
