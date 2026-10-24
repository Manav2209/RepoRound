"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "../../components/auth/AuthShell";
import { authClient } from "../../lib/auth-client";
import { authErrorMessage } from "../../lib/auth-errors";

export function ForgotPasswordForm({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: `${window.location.origin}/reset-password?returnTo=${encodeURIComponent(returnTo)}`,
    });
    if (result.error) {
      setError(authErrorMessage(result.error, "Could not send that email."));
      setSubmitting(false);
      return;
    }
    setSent(true);
    setSubmitting(false);
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Get back into your practice."
      description="We will email a single-use link. It expires in one hour and will not change your password until you choose a new one."
    >
      <div className="auth-panel-heading">
        <h2>Forgot password</h2>
        <p>Enter the email on your account.</p>
      </div>
      {sent ? (
        <div className="auth-success" role="status">
          <h3>Check your inbox</h3>
          <p>
            If an account exists for {email.trim()}, a reset link is on its way.
            Check spam if it does not arrive within a few minutes.
          </p>
          <Link
            href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
            className="button secondary"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={onSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            disabled={submitting}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}
      <p className="auth-switch">
        Remembered it?{" "}
        <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
