import type { InterviewResult as InterviewResultData } from "../types/interview";

const DIMENSIONS = [
  ["technicalKnowledge", "Technical knowledge"],
  ["problemSolving", "Problem solving"],
  ["communication", "Communication"],
  ["projectUnderstanding", "Project understanding"],
  ["depth", "Technical depth"],
] as const;
const CATEGORIES = [
  ["technicalDepth", "Technical depth"],
  ["architecture", "Architecture"],
  ["debugging", "Debugging"],
  ["implementation", "Implementation"],
  ["tradeoffReasoning", "Tradeoff reasoning"],
  ["communication", "Communication"],
] as const;
const LEVELS: Record<string, string> = {
  INSUFFICIENT_EVIDENCE: "Not assessed",
  BASIC: "Basic",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};

export default function InterviewResult({
  result,
}: {
  result: InterviewResultData;
}) {
  const supported = Object.values(result.evidence ?? {}).filter(
    (e) => e.level !== "INSUFFICIENT_EVIDENCE",
  ).length;
  const score = result.score;
  return (
    <div className="result">
      {result.coverage?.quality === "partial" && (
        <section className="panel" role="status">
          <h2>Partial assessment</h2>
          <p>
            This assessment includes {result.coverage.includedTurns} of{" "}
            {result.coverage.totalTurns} recorded answers.{" "}
            {result.coverage.truncatedTurns} answers were shortened. Feedback
            applies to the reviewed excerpts; missing details are not treated as
            weaknesses.
          </p>
        </section>
      )}
      <div className="result-overview">
        <section className="panel score-panel">
          <p className="eyebrow">Overall assessment</p>
          {score !== null ? (
            <div className="score-ring">
              <svg viewBox="0 0 160 160" aria-hidden="true">
                <circle cx="80" cy="80" r="68" className="ring-track" />
                <circle
                  cx="80"
                  cy="80"
                  r="68"
                  className="ring-fill"
                  strokeDasharray={427.26}
                  strokeDashoffset={
                    427.26 * (1 - Math.max(0, Math.min(100, score)) / 100)
                  }
                />
              </svg>
              <div>
                <strong>{score}</strong>
                <span>out of 100</span>
              </div>
            </div>
          ) : (
            <div className="no-score">
              <span aria-hidden="true">—</span>
              <h2>More evidence needed</h2>
              <p>
                Your recorded answers did not support a reliable overall score.
              </p>
            </div>
          )}
          <p className="hint">
            {score !== null
              ? "Average of the assessed categories. Unassessed areas are excluded."
              : "This is not a zero score. A longer practice round may provide more evidence."}
          </p>
          <div className="score-coverage">
            <span>Assessment coverage</span>
            <strong>{supported} / 6 areas</strong>
          </div>
        </section>
        <section className="panel dimensions-panel">
          <div className="section-heading">
            <h2>Skill breakdown</h2>
            <span className="badge">Out of 100</span>
          </div>
          <div className="dimensions">
            {DIMENSIONS.map(([key, label]) => {
              const value = result.dimensions?.[key] ?? null;
              return (
                <div key={key} className="dimension">
                  <div className="dimension-label">
                    <span>{label}</span>
                    <strong className={value === null ? "muted" : ""}>
                      {value === null ? "Not assessed" : value}
                    </strong>
                  </div>
                  {value !== null ? (
                    <div
                      className="dimension-bar"
                      role="meter"
                      aria-label={label}
                      aria-valuenow={value}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="dimension-fill"
                        style={{
                          width: Math.max(0, Math.min(100, value)) + "%",
                        }}
                      />
                    </div>
                  ) : (
                    <p className="dimension-empty">
                      No reliable answer for this area yet.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <section className="panel feedback-panel">
        <p className="eyebrow">Your feedback</p>
        <p className="feedback">{result.feedback}</p>
      </section>
      <div className="lists">
        <section className="panel">
          <div className="section-heading">
            <h2>What went well</h2>
            <span className="small-symbol positive" aria-hidden="true">
              ↗
            </span>
          </div>
          {result.strengths.length ? (
            <ul>
              {result.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No specific strengths could be supported by the recorded answers.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>What to work on</h2>
            <span className="small-symbol" aria-hidden="true">
              →
            </span>
          </div>
          {result.weaknesses.length ? (
            <ul>
              {result.weaknesses.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No specific gaps were identified. Unexplored topics are not
              counted against you.
            </p>
          )}
        </section>
      </div>
      {result.evidence && (
        <section className="evidence-section">
          <div className="section-heading">
            <div>
              <h2>Behind the assessment</h2>
              <p className="hint">
                Each assessment links back to what you actually said.
              </p>
            </div>
            <span className="badge">{supported} assessed</span>
          </div>
          <div className="evidence-grid">
            {CATEGORIES.map(([key, label]) => {
              const item = result.evidence?.[key];
              if (!item) return null;
              const assessed = item.level !== "INSUFFICIENT_EVIDENCE";
              return (
                <article
                  key={key}
                  className={
                    "panel evidence-card" + (assessed ? "" : " unassessed")
                  }
                >
                  <div className="section-heading">
                    <h3>{label}</h3>
                    <span className={"level-badge " + item.level.toLowerCase()}>
                      {LEVELS[item.level] ?? item.level}
                    </span>
                  </div>
                  <p>{item.explanation}</p>
                  {assessed && (
                    <div className="evidence-meta">
                      <span>
                        {item.score != null
                          ? item.score + " / 100"
                          : "Assessed"}
                      </span>
                      <span>
                        {Math.round(item.confidence * 100)}% confidence
                      </span>
                    </div>
                  )}
                  {!!item.observations?.length && (
                    <details className="answer-evidence">
                      <summary>
                        View supporting answers{" "}
                        <span>{item.observations.length}</span>
                      </summary>
                      {item.observations.map((o, i) => (
                        <blockquote key={i}>{o.quote}</blockquote>
                      ))}
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
