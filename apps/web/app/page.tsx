import StartInterview from "../components/StartInterview";

export default function Home() {
  return (
    <main className="landing">
      <div className="eyebrow">
        <span className="status-dot" /> Project-based practice
      </div>
      <h1>
        You built it.
        <br />
        <span>Now talk through it.</span>
      </h1>
      <p className="subtitle">
        A technical interview about your actual project. Explain your decisions,
        work through follow-ups, and get feedback grounded in your answers.
      </p>
      <section className="start-card">
        <StartInterview />
      </section>
      <div className="feature-grid">
        <article>
          <span className="feature-number">01</span>
          <h3>Your code, your context</h3>
          <p>
            Questions about architecture, implementation, and the decisions you
            made.
          </p>
        </article>
        <article>
          <span className="feature-number">02</span>
          <h3>A real conversation</h3>
          <p>Speak naturally. Follow-up questions adapt to what you explain.</p>
        </article>
        <article>
          <span className="feature-number">03</span>
          <h3>Feedback you can use</h3>
          <p>See your scores, supporting answers, and what to work on next.</p>
        </article>
      </div>
    </main>
  );
}
