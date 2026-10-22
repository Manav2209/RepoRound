"use client";

import Link from "next/link";
import { AuthShell } from "../../components/auth/AuthShell";
import { useAuth } from "../../components/auth/AuthProvider";

export function VerifiedNotice({ returnTo }: { returnTo: string }) {
  const { session, isPending } = useAuth();

  if (isPending) {
    return (
      <AuthShell
        eyebrow="Email verification"
        title="Checking your account."
        description="We are confirming your session before you continue."
      >
        <p className="auth-success" role="status">
          Checking verification status...
        </p>
      </AuthShell>
    );
  }

  if (!session?.user.emailVerified) {
    return (
      <AuthShell
        eyebrow="Email verification"
        title="Sign in to continue."
        description="We could not confirm a verified session in this browser."
      >
        <div className="auth-success" role="status">
          <h2>Check your account</h2>
          <p>
            If you followed the email link, sign in to continue. Otherwise,
            open the link in your inbox or request another one.
          </p>
          <Link
            href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
            className="button auth-submit"
          >
            Sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Email confirmed"
      title="You are ready to practice."
      description="Your account is verified. Start with a repository review or a system design round."
    >
      <div className="auth-success" role="status">
        <h2>Email verified</h2>
        <p>Choose your first practice context whenever you are ready.</p>
        <Link href={returnTo} className="button auth-submit">
          Continue to practice
        </Link>
      </div>
    </AuthShell>
  );
}
