"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "../../components/auth/AuthShell";
import { authClient } from "../../lib/auth-client";
import { authErrorMessage } from "../../lib/auth-errors";

export function ResetPasswordForm({
  token,
  returnTo,
}: {
  token: string;
  returnTo: string;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Use at least 12 characters for your password.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setSubmitting(true);
    const result = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    if (result.error) {
      setError(authErrorMessage(result.error, "Could not reset your password."));
      setSubmitting(false);
      return;
    }
    setComplete(true);
    setSubmitting(false);
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Choose a password you will remember."
      description="This changes your password and signs out every other session."
    >
      <div className="auth-panel-heading">
        <h2>New password</h2>
        <p>Use 12 or more characters.</p>
      </div>
      {complete ? (
        <div className="auth-success" role="status">
          <h3>Password updated</h3>
          <p>You can now sign in with your new password.</p>
          <Link
            href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
            className="button auth-submit"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={onSubmit}>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={submitting}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
