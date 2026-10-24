type AuthErrorLike = {
  message?: unknown;
  code?: unknown;
};

export function authErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!error || typeof error !== "object") return fallback;
  const value = error as AuthErrorLike;
  const code = typeof value.code === "string" ? value.code : "";
  if (code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_PASSWORD")
    return "That email and password do not match.";
  if (code === "EMAIL_NOT_VERIFIED")
    return "Verify your email before signing in.";
  if (code === "USER_ALREADY_EXISTS")
    return "An account with that email already exists. Try signing in.";
  if (code === "PASSWORD_TOO_SHORT")
    return "Use at least 12 characters for your password.";
  if (code === "INVALID_TOKEN" || code === "EXPIRED_TOKEN")
    return "This link is invalid or has expired. Request a new one.";
  if (typeof value.message === "string" && value.message.trim())
    return value.message;
  return fallback;
}
