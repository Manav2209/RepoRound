import type { Metadata } from "next";
import { safeReturnTo } from "../../lib/return-to";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your RepoRound account.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <SignInForm
      returnTo={safeReturnTo(first(params.returnTo))}
      oauthError={first(params.error) === "oauth"}
    />
  );
}
