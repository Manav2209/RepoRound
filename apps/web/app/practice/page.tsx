import type { Metadata } from "next";
import StartInterview from "../../components/StartInterview";

export const metadata: Metadata = {
  title: "Practice",
  description: "Start a repository review or system design practice round.",
};

export default function PracticePage() {
  return (
    <main className="practice-page">
      <div className="practice-heading">
        <p className="eyebrow">Your next practice round</p>
        <h1>Build confidence. One interview at a time.</h1>
        <p className="subtitle">
          Bring your own code or take on a system design challenge. Pick a focus
          and talk through the decisions that matter.
        </p>
      </div>
      <section className="start-card">
        <StartInterview />
      </section>
    </main>
  );
}
