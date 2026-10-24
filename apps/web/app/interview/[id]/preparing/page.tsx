"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ApiError, getInterview } from "../../../../lib/api";
import type { InterviewView } from "../../../../types/interview";

export default function PreparingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: interviewId } = use(params);
  const [view, setView] = useState<InterviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll(): Promise<void> {
      try {
        const data = await getInterview(interviewId, controller.signal);
        if (cancelled) return;
        failures = 0;
        setView(data);
        if (data.status === "failed") {
          setError(
            data.error ??
              "We couldn't prepare this repository. Please try a new interview.",
          );
          return;
        }
        if (
          [
            "ready",
            "active",
            "completing",
            "completed",
            "evaluation_failed",
          ].includes(data.status)
        )
          return;
      } catch (err) {
        if (cancelled) return;
        if (
          err instanceof ApiError &&
          (err.status === 401 || err.status === 404)
        ) {
          setError(
            err.status === 401
              ? "Your session has expired. Sign in again to continue this interview."
              : "This interview is not available on your account. Start a new interview or sign in with the account that created it.",
          );
          return;
        }
        if (++failures >= 4) {
          setError(
            "We couldn't check preparation progress. Make sure the backend is running, then retry.",
          );
          return;
        }
      }
      if (!cancelled) timer = setTimeout(poll, 2500);
    }
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [interviewId, revision]);

  const ready = view?.status === "ready" || view?.status === "active";
  const finished = ["completing", "completed", "evaluation_failed"].includes(
    view?.status ?? "",
  );
  const analyzed =
    ready ||
    finished ||
    view?.preparationStage === "planning" ||
    view?.preparationStage === "ready";
  const steps = [
    {
      title: "Repository received",
      description: "Your project is queued for review.",
      done: Boolean(view),
      active: !view,
    },
    {
      title: "Reviewing your project",
      description:
        "Reading the project structure, source code, and architecture.",
      done: analyzed,
      active: Boolean(view) && !analyzed,
    },
    {
      title: "Preparing the conversation",
      description:
        "Creating questions around your implementation and decisions.",
      done: ready || finished,
      active: analyzed && !ready && !finished,
    },
  ];
  return (
    <main className="preparing">
      <Link href="/" className="back-link">
        ← Back to home
      </Link>
      <p className="eyebrow">
        {error
          ? "Preparation interrupted"
          : ready
            ? "Ready when you are"
            : finished
              ? "Interview finished"
              : "Setting things up"}
      </p>
      <h1>
        {error
          ? "We couldn’t prepare your interview."
          : ready
            ? "Your interview is ready."
            : finished
              ? "Your answers are being reviewed."
              : "Getting to know your project."}
      </h1>
      <p className="subtitle">
        {view?.githubUrl
          ? view.githubUrl.replace("https://github.com/", "")
          : "We’re preparing a conversation around your code."}
      </p>
      {error ? (
        <section className="panel preparation-error" role="alert">
          <p className="error">{error}</p>
          <div className="preparation-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setError(null);
                setRevision((n) => n + 1);
              }}
            >
              Retry loading
            </button>
            <Link href="/" className="button">
              New interview
            </Link>
          </div>
        </section>
      ) : (
        <>
          <ol
            className="preparation-steps"
            aria-label="Preparation progress"
            aria-live="polite"
          >
            {steps.map((step, i) => (
              <li
                key={step.title}
                className={step.done ? "done" : step.active ? "active" : ""}
              >
                <span className="step-indicator" aria-hidden="true">
                  {step.done ? (
                    "✓"
                  ) : step.active ? (
                    <span className="loader" />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <div>
                  <h2>{step.title}</h2>
                  <p>{step.description}</p>
                </div>
                <span className="step-state">
                  {step.done
                    ? "Complete"
                    : step.active
                      ? "In progress"
                      : "Next"}
                </span>
              </li>
            ))}
          </ol>
          {ready ? (
            <section className="ready-panel">
              <h2>A quick check before you start</h2>
              <p className="hint">
                Choose a quiet place and have your microphone ready. You’ll be
                asked to allow microphone access when you start.
              </p>
              <Link className="button" href={"/interview/" + interviewId}>
                {view?.status === "active"
                  ? "Resume interview"
                  : "Start interview"}{" "}
                <span aria-hidden="true">→</span>
              </Link>
            </section>
          ) : finished ? (
            <Link
              className="button"
              href={"/interview/" + interviewId + "/result"}
            >
              View assessment →
            </Link>
          ) : (
            <p className="hint">
              This can take a minute. We’ll keep this page updated as your
              interview is prepared.
            </p>
          )}
        </>
      )}
    </main>
  );
}
