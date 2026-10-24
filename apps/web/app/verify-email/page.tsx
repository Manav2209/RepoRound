import type { Metadata } from "next";
import { AuthShell } from "../../components/auth/AuthShell";
import { ResendVerificationForm } from "./ResendVerificationForm";
import { safeReturnTo } from "../../lib/return-to";
import { VerifiedNotice } from "./VerifiedNotice";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Confirm your email address to start practicing.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const verified = first(params.verified) === "1";
  const email = first(params.email) ?? "";
  const returnTo = safeReturnTo(first(params.returnTo));

  if (verified) {
    return <VerifiedNotice returnTo={returnTo} />;
  }

  return (
    <AuthShell
      eyebrow="One quick step"
      title="Check your inbox before you start."
      description="We require a verified email so interviews and transcripts stay with the right person. The link expires after one hour."
    >
      <div className="auth-panel-heading">
        <h2>Verify your email</h2>
        <p>Open the link we sent you. If it expired, request another below.</p>
      </div>
      <ResendVerificationForm initialEmail={email} returnTo={returnTo} />
    </AuthShell>
  );
}
