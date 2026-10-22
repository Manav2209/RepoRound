import type { Metadata } from "next";
import { AccountPanel } from "./AccountPanel";

export const metadata: Metadata = {
  title: "Account",
  description: "Manage your RepoRound account and sign-in methods.",
};

export default function AccountPage() {
  return <AccountPanel />;
}
