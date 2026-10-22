import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const digest = (value: string) => createHash("sha256").update(value).digest();
function normalize(address: string | undefined): string | undefined {
  if (!address || !isIP(address)) return undefined;
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4)
    return address.slice(7);
  return isIP(address) === 6
    ? new URL(`http://[${address}]/`).hostname.slice(1, -1)
    : address;
}

/** Forwarded identity is accepted only with a separate proxy credential. */
export function clientIp(
  request: Request,
  peer?: string,
  proxyToken?: string,
): string {
  const provided = request.headers.get("X-RepoRound-Proxy-Token") ?? "";
  if (
    proxyToken &&
    provided &&
    timingSafeEqual(digest(proxyToken), digest(provided))
  ) {
    const forwarded = normalize(
      request.headers.get("X-RepoRound-Client-IP") ?? undefined,
    );
    if (forwarded) return forwarded;
  }
  return normalize(peer) ?? "unknown";
}
