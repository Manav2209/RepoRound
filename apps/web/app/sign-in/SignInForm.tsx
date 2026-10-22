"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "../../components/auth/AuthShell";
import { ProviderButtons } from "../../components/auth/ProviderButtons";
import { useAuthCapabilities } from "../../hooks/useAuthCapabilities";
import { authClient } from "../../lib/auth-client";
import { authErrorMessage } from "../../lib/auth-errors";

export function SignInForm({
  returnTo,
  oauthError,
}: {
  returnTo: string;
  oauthError: boolean;
}) {
  const router = useRouter();
  const capabilities = useAuthCapabilities();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    oauthError ? "We could not complete that sign-in. Please try again." : null,
  );
  const [unverified, setUnverified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setUnverified(false);
    setSubmitting(true);
    const result = await authClient.signIn.email({
      email: email.trim(),
      password,
      rememberMe: true,
      callbackURL: returnTo,
    });
    if (result.error) {
      const code =
        result.error && typeof result.error === "object"
          ? (result.error as { code?: unknown }).code
          : undefined;
      setUnverified(code === "EMAIL_NOT_VERIFIED");
      setError(authErrorMessage(result.error, "Could not sign you in."));
      setSubmitting(false);
      return;
    }
    router.push(returnTo);
    router.refresh();
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Pick up where you left off."
      description="Sign in to start another round, review past interviews, or connect a social account."
    >
      <div className="auth-panel-heading">
        <h2>Sign in</h2>
        <p>Use the email you signed up with.</p>
      </div>
      <ProviderButtons capabilities={capabilities} callbackURL={returnTo} />
      <div className="auth-divider">
        <span>or use email</span>
      </div>
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
        <div className="label-row">
          <label htmlFor="password">Password</label>
          <Link
            href={`/forgot-password?returnTo=${encodeURIComponent(returnTo)}`}
          >
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Your password"
          disabled={submitting}
        />
        {error && (
          <p className="error" role="alert">
            {error}
            {unverified && (
              <>
                {" "}
                <Link
                  className="inline-link"
                  href={`/verify-email?email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(returnTo)}`}
                >
                  Resend the verification email
                </Link>
              </>
            )}
          </p>
        )}
        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p className="auth-switch">
        New to RepoRound?{" "}
        <Link href={`/sign-up?returnTo=${encodeURIComponent(returnTo)}`}>
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
