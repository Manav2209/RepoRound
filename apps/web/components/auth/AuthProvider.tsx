"use client";

import { createContext, useContext, type ReactNode } from "react";
import { authClient } from "../../lib/auth-client";

type SessionData = typeof authClient.$Infer.Session;

type AuthState = {
  session: SessionData | null;
  isPending: boolean;
  isRefetching: boolean;
  refetch: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending, isRefetching, refetch } = authClient.useSession();

  return (
    <AuthContext.Provider
      value={{
        session: data ?? null,
        isPending,
        isRefetching,
        refetch: async () => {
          await refetch();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
