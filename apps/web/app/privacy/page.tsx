import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How RepoRound handles account and interview data.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <p className="eyebrow">Privacy</p>
      <h1>What RepoRound stores.</h1>
      <p className="legal-updated">Last updated: October 22, 2026</p>

      <section>
        <h2>Account data</h2>
        <p>
          We store your name, email address, email verification status, and
          sign-in provider identifiers. Passwords are hashed with Argon2id;
          RepoRound never stores your plaintext password. Session cookies are
          HttpOnly and the server stores a keyed hash of each session token.
        </p>
      </section>

      <section>
        <h2>Interview data</h2>
        <p>
          When you start a practice round, we store the repository metadata or
          system design problem, conversation turns, interview state,
          architecture submissions, evaluation results, and related operational
          records. Repository analysis may include file paths, symbols, and
          bounded code excerpts needed to ground interview questions.
        </p>
      </section>

      <section>
        <h2>Service providers</h2>
        <p>
          Email verification and password reset messages are delivered through
          Resend. OAuth sign-in, when configured, exchanges identity information
          with Google or GitHub. Live voice sessions use LiveKit. Language-model
          requests are sent to the configured model provider. These providers
          process data only to deliver the requested service.
        </p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>
          Account and interview data is retained until you delete your account.
          Deleting your account removes your interviews, transcripts,
          evaluation results, access sessions, linked sign-in accounts, and
          system design graph data. Finish active interviews before deleting
          your account. If design graph cleanup fails, deletion stops so you can
          retry rather than leaving orphaned data.
        </p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          RepoRound uses essential cookies for authentication, CSRF protection,
          and OAuth state. We do not use advertising cookies or sell personal
          data.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can delete your account from the account page, request a password
          reset, or contact the operator of this deployment for access and
          privacy requests. Interview transcripts may contain personal
          information you chose to say aloud; do not share information you are
          not comfortable processing.
        </p>
      </section>

      <Link href="/" className="back-link">
        ← Back to RepoRound
      </Link>
    </main>
  );
}
