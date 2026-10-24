"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "../../lib/auth-client";
import { authErrorMessage } from "../../lib/auth-errors";

export function ResendVerificationForm({
  initialEmail,
  returnTo,
}: {
  initialEmail: string;
  returnTo: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await authClient.sendVerificationEmail({
      email: email.trim(),
      callbackURL: `${window.location.origin}/verify-email?verified=1&returnTo=${encodeURIComponent(returnTo)}`,
    });
    if (result.error) {
      setError(
        authErrorMessage(
          result.error,
          "Could not send the verification email.",
        ),
      );
      setSubmitting(false);
      return;
    }
    setSent(true);
    setSubmitting(false);
  }

  if (sent) {
    return (
      <div className="auth-success" role="status">
        <h3>Another email is on the way</h3>
        <p>
          Check {email.trim()}, including spam. The previous link may still work
          until it expires.
        </p>
        <Link
          href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
          className="button secondary"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
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
        {submitting ? "Sending..." : "Resend verification email"}
      </button>
      <p className="auth-switch">
        Already verified?{" "}
        <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
