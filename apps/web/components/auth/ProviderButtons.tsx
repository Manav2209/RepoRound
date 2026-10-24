"use client";

import { useState } from "react";
import { authClient } from "../../lib/auth-client";
import { authErrorMessage } from "../../lib/auth-errors";
import type { AuthCapabilities } from "../../lib/auth-capabilities";

type Provider = "google" | "github";

export function ProviderButtons({
  capabilities,
  callbackURL,
  mode = "signin",
}: {
  capabilities: AuthCapabilities;
  callbackURL: string;
  mode?: "signin" | "link";
}) {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect(provider: Provider) {
    setPending(provider);
    setError(null);
    const result =
      mode === "link"
        ? await authClient.linkSocial({ provider, callbackURL })
        : await authClient.signIn.social({
            provider,
            callbackURL,
            errorCallbackURL: `/sign-in?error=oauth&returnTo=${encodeURIComponent(callbackURL)}`,
          });
    if (result.error) {
      setError(authErrorMessage(result.error, "Could not connect that account."));
      setPending(null);
    }
  }

  const providers: Array<{
    id: Provider;
    label: string;
    mark: string;
  }> = [
    { id: "google", label: "Google", mark: "G" },
    { id: "github", label: "GitHub", mark: "GH" },
  ];

  return (
    <div className="provider-stack">
      {providers.map((provider) => {
        const enabled = capabilities.providers[provider.id];
        const busy = pending === provider.id;
        return (
          <button
            key={provider.id}
            type="button"
            className="provider-button"
            disabled={!enabled || pending !== null}
            title={
              enabled
                ? undefined
                : `${provider.label} sign-in is not configured on this deployment yet.`
            }
            onClick={() => connect(provider.id)}
          >
            <span className="provider-mark" aria-hidden="true">
              {provider.mark}
            </span>
            {busy
              ? "Connecting..."
              : mode === "link"
                ? `Connect ${provider.label}`
                : `Continue with ${provider.label}`}
            {!enabled && <span className="provider-soon">Soon</span>}
          </button>
        );
      })}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
