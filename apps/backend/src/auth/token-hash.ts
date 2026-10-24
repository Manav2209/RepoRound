import { createHmac } from "node:crypto";

const HASHED_TOKEN = /^[a-f0-9]{64}$/;

export function createSessionTokenHasher(secret: string) {
  return (token: string): string =>
    HASHED_TOKEN.test(token)
      ? token
      : createHmac("sha256", secret).update(token).digest("hex");
}
