import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using RepoRound interview practice.",
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <p className="eyebrow">Terms</p>
      <h1>The ground rules for practice.</h1>
      <p className="legal-updated">Last updated: October 22, 2026</p>

      <section>
        <h2>Practice, not hiring</h2>
        <p>
          RepoRound is interview practice software. Scores and feedback are
          generated with automated systems and are not a hiring decision,
          professional assessment, or guarantee of interview performance.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <p>
          Provide accurate account information, keep your password private, and
          use one account per person. You are responsible for activity under
          your account. Tell the operator promptly if you believe your account
          has been compromised.
        </p>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          You retain ownership of the repository information, designs, and
          answers you submit. You grant the service permission to process that
          content to prepare questions, run the interview, and produce feedback.
          Do not submit secrets, credentials, or content you do not have
          permission to use.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not attempt to access another person&apos;s interviews, disrupt the
          service, bypass rate limits or authentication, scrape other users&apos;
          data, or use the service to break the law. Automated abuse may result
          in suspension.
        </p>
      </section>

      <section>
        <h2>Availability and changes</h2>
        <p>
          The service is provided as-is without warranties. Features, model
          providers, and availability may change. We may suspend accounts that
          threaten the service or other users. These terms may be updated; the
          date above reflects the latest revision.
        </p>
      </section>

      <section>
        <h2>Ending your use</h2>
        <p>
          You may delete your account at any time from the account page. Account
          deletion removes your stored interviews and related data as described
          in the Privacy Policy.
        </p>
      </section>

      <Link href="/" className="back-link">
        ← Back to RepoRound
      </Link>
    </main>
  );
}
