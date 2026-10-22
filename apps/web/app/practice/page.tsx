import type { Metadata } from "next";
import Link from "next/link";
import StartInterview from "../../components/StartInterview";

export const metadata: Metadata = {
  title: "Practice",
  description: "Start a repository review or system design practice round.",
};

export default function PracticePage() {
  return (
    <main className="practice-page">
      <Link className="back-link" href="/">
        ← Back to home
      </Link>
      <div className="practice-heading">
        <p className="eyebrow">New practice round</p>
        <h1>What do you want to work through?</h1>
        <p className="subtitle">
          Choose a context and we will build the interview around it. Have your
          microphone ready when the room opens.
        </p>
      </div>
      <section className="start-card">
        <StartInterview />
      </section>
    </main>
  );
}
