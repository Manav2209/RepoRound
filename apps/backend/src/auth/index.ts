import { betterAuth } from "better-auth";
import type { BackendConfig } from "../config.js";
import { createHashedSessionAdapter } from "./adapter.js";
import { removeUserDesignGraphs } from "./account-cleanup.js";
import { createAuthEmails } from "./email.js";
import { createSessionTokenHasher } from "./token-hash.js";

export function createAuth(config: BackendConfig) {
  const hashToken = createSessionTokenHasher(config.BETTER_AUTH_SECRET);
  const emails = createAuthEmails(config);
  const trustedOrigins = (
    config.AUTH_TRUSTED_ORIGINS ?? config.CORS_ALLOWED_ORIGINS
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const secureCookie = config.AUTH_COOKIE_SECURE
    ? config.AUTH_COOKIE_SECURE === "true"
    : config.BETTER_AUTH_URL.startsWith("https://");

  const google =
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: config.GOOGLE_CLIENT_ID,
            clientSecret: config.GOOGLE_CLIENT_SECRET,
          },
        }
      : {};
  const github =
    config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: config.GITHUB_CLIENT_ID,
            clientSecret: config.GITHUB_CLIENT_SECRET,
          },
        }
      : {};

  return betterAuth({
    appName: "RepoRound",
    baseURL: config.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: config.BETTER_AUTH_SECRET,
    database: createHashedSessionAdapter(hashToken),
    trustedOrigins: [config.BETTER_AUTH_URL, ...trustedOrigins],
    socialProviders: { ...google, ...github },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: emails.sendResetPassword,
      password: {
        hash: (password) =>
          Bun.password.hash(password, {
            algorithm: "argon2id",
            memoryCost: 65_536,
            timeCost: 3,
          }),
        verify: ({ hash, password }) => Bun.password.verify(password, hash),
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: emails.sendVerificationEmail,
    },
    session: {
      expiresIn: config.AUTH_SESSION_DAYS * 24 * 60 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => removeUserDesignGraphs(user.id),
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 4 },
        "/send-verification-email": { window: 60, max: 4 },
      },
    },
    advanced: {
      cookiePrefix: "reporound",
      useSecureCookies: secureCookie,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        path: "/",
      },
      ipAddress: {
        ipAddressHeaders: ["x-reporound-client-ip"],
      },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
