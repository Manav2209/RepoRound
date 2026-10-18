import { Redis } from "ioredis";

/**
 * BullMQ requires `maxRetriesPerRequest: null`. Pass an explicit ioredis
 * instance (not connection options) so it works in native ESM/Bun.
 */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
