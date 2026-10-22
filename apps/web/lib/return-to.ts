export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 2048) return "/practice";
  if (!value.startsWith("/") || value.startsWith("//")) return "/practice";
  if (value.includes("\\") || value.includes("\n") || value.includes("\r"))
    return "/practice";
  return value;
}
