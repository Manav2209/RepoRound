import Link from "next/link";

export default function Home() {
  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="status-dot" /> Interview practice that knows the
            work
          </div>
          <h1>
            Practice the conversation,
            <br />
            <span>not just the answer.</span>
          </h1>
          <p className="subtitle">
            RepoRound runs a realistic technical interview about your actual
            repository or a system design challenge. Speak naturally, defend
            your decisions, and get feedback tied to what you said.
          </p>
          <div className="hero-actions">
            <Link href="/practice" className="button hero-primary">
              Start practicing <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="hero-note">
            Voice-first · 10–15 minutes · Feedback with evidence
          </p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="round-window">
            <div className="round-topbar">
              <span className="window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>reporound / practice</span>
            </div>
            <div className="round-meta">
              <span className="badge">Project deep dive</span>
              <span className="round-count">Question 03 / 08</span>
            </div>
            <p className="round-question">
              “You moved evaluation off the request path. What breaks if the
              queue backs up for ten minutes?”
            </p>
            <div className="sound-row">
              <span className="sound-bars">
                {Array.from({ length: 14 }, (_, index) => (
                  <i key={index} />
                ))}
              </span>
              <span>Listening</span>
            </div>
            <div className="round-evidence">
              <span className="evidence-label">Evidence captured</span>
              <p>
                Explained the retry boundary and accepted the stale-result
                trade-off.
              </p>
            </div>
          </div>
          <div className="floating-note">Grounded in your repository</div>
        </div>
      </section>

      <section className="landing-section" id="how-it-works">
        <div className="section-intro">
          <p className="eyebrow">How a round works</p>
          <h2>Less trivia. More thinking out loud.</h2>
        </div>
        <ol className="round-steps">
          <li>
            <span className="step-number">01</span>
            <h3>Choose your ground</h3>
            <p>
              Point RepoRound at a public GitHub repository, or pick a system
              design prompt and build your architecture on the canvas.
            </p>
          </li>
          <li>
            <span className="step-number">02</span>
            <h3>Talk it through</h3>
            <p>
              A voice interviewer asks about architecture, trade-offs, and
              implementation details. Follow-ups adapt to your answers.
            </p>
          </li>
          <li>
            <span className="step-number">03</span>
            <h3>Review the evidence</h3>
            <p>
              See scores, quoted answers, and the gaps worth working on next. No
              feedback without something you actually said.
            </p>
          </li>
        </ol>
      </section>

      <footer className="landing-footer">
        <span>RepoRound</span>
        <span className="footer-copy">
          Built for engineers who want the rehearsal to feel real.
        </span>
        <nav aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </main>
  );
}
