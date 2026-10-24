"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ProviderButtons } from "../../components/auth/ProviderButtons";
import { useAuth } from "../../components/auth/AuthProvider";
import { useAuthCapabilities } from "../../hooks/useAuthCapabilities";
import { authClient } from "../../lib/auth-client";
import { authErrorMessage } from "../../lib/auth-errors";
import { deleteReport, getReports } from "../../lib/api";
import type { ReportListItem } from "../../types/interview";

export function AccountPanel() {
  const { session, isPending, isRefetching, refetch } = useAuth();
  const capabilities = useAuthCapabilities();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reportsState, setReportsState] = useState<{
    userId: string;
    items: ReportListItem[];
  } | null>(null);
  const [reportsErrorFor, setReportsErrorFor] = useState<string | null>(null);
  const [reportsAttempt, setReportsAttempt] = useState(0);
  const [reportDeleteError, setReportDeleteError] = useState<string | null>(null);
  const userId = session?.user.id;
  const reports =
    reportsState && reportsState.userId === userId ? reportsState.items : null;
  const reportsError = reportsErrorFor === userId;

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void getReports(controller.signal)
      .then(({ reports: items }) => {
        if (controller.signal.aborted) return;
        setReportsState({ userId, items });
        setReportsErrorFor(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setReportsErrorFor(userId);
      });
    return () => controller.abort();
  }, [userId, reportsAttempt]);

  if (isPending || isRefetching) {
    return (
      <main className="account-page">
        <span className="loader" aria-label="Loading account" />
      </main>
    );
  }

  if (!session) {
    return (
      <main className="account-page">
        <section className="panel account-empty">
          <h1>Sign in to view your account.</h1>
          <p className="subtitle">
            Your sessions and interviews are tied to your RepoRound account.
          </p>
          <Link href="/sign-in?returnTo=%2Faccount" className="button">
            Sign in
          </Link>
        </section>
      </main>
    );
  }

  const user = session.user;
  const initial = (user.name || user.email).slice(0, 1).toUpperCase();
  const joined = new Date(user.createdAt).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    await refetch();
    router.push("/");
    router.refresh();
  }

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    setDeleteError(null);
    if (confirmation !== "DELETE") {
      setDeleteError("Type DELETE to confirm.");
      return;
    }
    setDeleting(true);
    const result = await authClient.deleteUser({
      password: password || undefined,
      callbackURL: `${window.location.origin}/`,
    });
    if (result.error) {
      setDeleteError(
        authErrorMessage(
          result.error,
          "Could not delete your account. Sign in again and retry.",
        ),
      );
      setDeleting(false);
      return;
    }
    await refetch();
    router.push("/");
    router.refresh();
  }

  return (
    <main className="account-page">
      <div className="account-heading">
        <p className="eyebrow">Your account</p>
        <h1>Practice history, under one identity.</h1>
        <p className="subtitle">
          Every interview you start while signed in belongs to this account.
        </p>
      </div>

      <section className="account-grid">
        <article className="panel account-profile">
          <div className="profile-row">
            <span className="profile-avatar" aria-hidden="true">
              {initial}
            </span>
            <div>
              <h2>{user.name || "Your profile"}</h2>
              <p>{user.email}</p>
            </div>
          </div>
          <dl className="account-facts">
            <div>
              <dt>Email status</dt>
              <dd className="verified-fact">Verified</dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>{joined}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="secondary"
            onClick={signOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <h2>Sign-in methods</h2>
              <p className="hint">
                Link another provider with the same verified email.
              </p>
            </div>
          </div>
          <ProviderButtons
            capabilities={capabilities}
            callbackURL="/account"
            mode="link"
          />
          <p className="hint account-hint">
            Linking is explicit. RepoRound will not silently merge accounts by
            email.
          </p>
        </article>

        <article className="panel account-actions">
          <h2>Your reports</h2>
          {reportsError ? (
            <div>
              <p className="hint">We couldn&apos;t load your reports.</p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setReportsErrorFor(null);
                  setReportsAttempt((attempt) => attempt + 1);
                }}
              >
                Try again
              </button>
            </div>
          ) : reports === null ? (
            <p className="hint">Loading reports…</p>
          ) : reports.length === 0 ? (
            <p className="hint">
              Your completed practice reports will appear here.
            </p>
          ) : (
            <ul className="report-list">
              {reports.map((report) => (
                <li key={report.interviewId}>
                  <Link href={`/interview/${report.interviewId}/result`}>
                    <span className="report-title">{report.title}</span>
                    <span className="report-meta">
                      {report.mode === "SYSTEM_DESIGN"
                        ? "System design"
                        : "Repository review"}
                      {report.completedAt
                        ? ` · ${new Date(report.completedAt).toLocaleDateString()}`
                        : ""}
                    </span>
                    <span className="report-score">
                      {report.score === null
                        ? "View report"
                        : `${report.score}/100`}
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      if (!window.confirm("Delete this report permanently?")) return;
                      setReportDeleteError(null);
                      void deleteReport(report.interviewId)
                        .then(() => setReportsAttempt((attempt) => attempt + 1))
                        .catch(() => setReportDeleteError("Could not delete the report. Please try again."));
                    }}
                  >Delete report</button>
                </li>
              ))}
            </ul>
          )}
          {reportDeleteError && <p className="error" role="alert">{reportDeleteError}</p>}
          <Link href="/practice" className="button">
            New practice round
          </Link>
        </article>

        <article className="panel danger-zone">
          <div>
            <h2>Delete account</h2>
            <p className="hint">
              This permanently deletes your account, reports, any remaining
              interview records, and design graph data. It cannot be undone.
            </p>
          </div>
          {!deleteOpen ? (
            <button
              type="button"
              className="danger-button"
              onClick={() => setDeleteOpen(true)}
            >
              Delete my account
            </button>
          ) : (
            <form className="delete-form" onSubmit={deleteAccount}>
              <p className="error">
                Active interviews should be finished first. Deletion stops if
                design data cannot be removed.
              </p>
              <label htmlFor="delete-password">
                Password (leave blank for social-only accounts)
              </label>
              <input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={deleting}
              />
              <label htmlFor="delete-confirmation">
                Type DELETE to confirm
              </label>
              <input
                id="delete-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                disabled={deleting}
              />
              {deleteError && (
                <p className="error" role="alert">
                  {deleteError}
                </p>
              )}
              <div className="delete-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setDeleteOpen(false);
                    setDeleteError(null);
                    setConfirmation("");
                    setPassword("");
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="danger-button"
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Permanently delete"}
                </button>
              </div>
            </form>
          )}
        </article>
      </section>
    </main>
  );
}
