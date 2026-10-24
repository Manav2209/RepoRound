import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../../components/auth/AuthShell";
import { safeReturnTo } from "../../lib/return-to";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your RepoRound account.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const value = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  const returnTo = safeReturnTo(value);
  if (!token) {
    return (
      <AuthShell
        eyebrow="Account recovery"
        title="That link is incomplete."
        description="Password reset links are single-use and expire after one hour."
      >
        <div className="auth-panel-heading">
          <h2>Request a new link</h2>
          <p>We can send a fresh reset email.</p>
        </div>
        <Link
          href={`/forgot-password?returnTo=${encodeURIComponent(returnTo)}`}
          className="button auth-submit"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }
  return <ResetPasswordForm token={token} returnTo={returnTo} />;
}
