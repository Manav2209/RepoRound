"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "../../components/auth/AuthShell";
import { ProviderButtons } from "../../components/auth/ProviderButtons";
import { useAuthCapabilities } from "../../hooks/useAuthCapabilities";
import { authClient } from "../../lib/auth-client";
import { authErrorMessage } from "../../lib/auth-errors";

export function SignUpForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const capabilities = useAuthCapabilities();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    const result = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
      callbackURL: `${window.location.origin}/verify-email?verified=1&returnTo=${encodeURIComponent(returnTo)}`,
    });
    if (result.error) {
      setError(
        authErrorMessage(result.error, "Could not create your account."),
      );
      setSubmitting(false);
      return;
    }
    router.push(
      `/verify-email?email=${encodeURIComponent(email.trim())}&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  return (
    <AuthShell
      eyebrow="Create your account"
      title="A better rehearsal starts here."
      description="Keep your practice and feedback tied to your account. Email verification keeps your interviews private."
    >
      <div className="auth-panel-heading">
        <h2>Get started</h2>
        <p>Free to use. No credit card.</p>
      </div>
      <ProviderButtons capabilities={capabilities} callbackURL={returnTo} />
      <div className="auth-divider">
        <span>or sign up with email</span>
      </div>
      <form className="auth-form" onSubmit={onSubmit}>
        <label htmlFor="name">Name</label>
        <input
          id="name"
          autoComplete="name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          disabled={submitting}
        />
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
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 12 characters"
          aria-describedby="password-hint"
          disabled={submitting}
        />
        <p className="field-hint" id="password-hint">
          Use 12 or more characters. A passphrase works well.
        </p>
        <label htmlFor="confirm-password">Confirm password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="Repeat your password"
          disabled={submitting}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "Creating account..." : "Create account"}
        </button>
        <p className="legal-hint">
          By creating an account you agree to the{" "}
          <Link href="/terms">Terms</Link> and{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </form>
      <p className="auth-switch">
        Already have an account?{" "}
        <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
