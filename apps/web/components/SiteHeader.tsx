"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { useAuth } from "./auth/AuthProvider";

export default function SiteHeader() {
  const { session, isPending, refetch } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    await refetch();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="app-header">
      <Link className="brand" href="/" aria-label="RepoRound home">
        <span className="brand-mark" aria-hidden="true">
          R
        </span>
        <span>RepoRound</span>
      </Link>
      <nav className="site-nav" aria-label="Primary navigation">
        <Link href="/practice">Practice</Link>
        {isPending ? (
          <span className="nav-placeholder" aria-hidden="true" />
        ) : session ? (
          <>
            <Link href="/account">Account</Link>
            <button
              type="button"
              className="nav-signout"
              onClick={signOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </>
        ) : (
          <>
            <Link href="/sign-in">Sign in</Link>
            <Link href="/sign-up" className="nav-cta">
              Get started
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
