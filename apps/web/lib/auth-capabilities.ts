export type AuthCapabilities = {
  emailPassword: boolean;
  providers: {
    google: boolean;
    github: boolean;
  };
};

const fallback: AuthCapabilities = {
  emailPassword: true,
  providers: { google: false, github: false },
};

let pending: Promise<AuthCapabilities> | null = null;

export function getAuthCapabilities(): Promise<AuthCapabilities> {
  if (pending) return pending;
  pending = fetch("/api/v1/auth/capabilities", {
    credentials: "same-origin",
    signal: AbortSignal.timeout(8000),
  })
    .then(async (response) => {
      if (!response.ok) return fallback;
      return (await response.json()) as AuthCapabilities;
    })
    .catch(() => fallback)
    .finally(() => {
      pending = null;
    });
  return pending;
}
