import type { Metadata } from "next";
import { safeReturnTo } from "../../lib/return-to";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your RepoRound account.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const value = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  return <ForgotPasswordForm returnTo={safeReturnTo(value)} />;
}
