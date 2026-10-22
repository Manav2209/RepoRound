import type { Metadata } from "next";
import { safeReturnTo } from "../../lib/return-to";
import { SignUpForm } from "./SignUpForm";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a RepoRound account and start a practice round.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const value = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  return <SignUpForm returnTo={safeReturnTo(value)} />;
}
