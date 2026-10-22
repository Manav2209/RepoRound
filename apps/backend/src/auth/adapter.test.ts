import { expect, test } from "bun:test";
import type { DBAdapter } from "better-auth";
import { wrapSessionTokens } from "./adapter.js";
import { createSessionTokenHasher } from "./token-hash.js";

const hash = (token: string) => `hashed:${token}`;

function fakeAdapter() {
  const calls: Array<{ method: string; args: unknown }> = [];
  const record =
    (method: string, result: (args: unknown) => unknown = (args) => args) =>
    async (args: unknown) => {
      calls.push({ method, args });
      return result(args);
    };
  const makeBase = (id: string): DBAdapter => {
    const base = {
      id,
      create: record("create", (args) => {
        const { data } = args as { data: Record<string, unknown> };
        return { id: "created", ...data };
      }),
      findOne: record("findOne"),
      findMany: record("findMany"),
      update: record("update"),
      updateMany: record("updateMany"),
      delete: record("delete"),
      deleteMany: record("deleteMany"),
      consumeOne: record("consumeOne"),
      transaction: async (callback: (adapter: DBAdapter) => unknown) => {
        calls.push({ method: "transaction", args: undefined });
        return callback(makeBase("transaction"));
      },
    };
    return base as unknown as DBAdapter;
  };
  return { base: makeBase("base"), calls };
}

const where = (field: string, value: unknown) => [
  { field, value, operator: "eq", connector: "AND" },
];

test("session creation stores only the token hash but returns the raw token", async () => {
  const { base, calls } = fakeAdapter();
  const adapter = wrapSessionTokens(base, hash);

  const created = await adapter.create({
    model: "session",
    data: { token: "raw-session", userId: "user-1" },
  } as never);

  expect(created).toEqual({
    id: "created",
    token: "raw-session",
    userId: "user-1",
  });
  expect(calls[0]?.args).toEqual({
    model: "session",
    data: { token: "hashed:raw-session", userId: "user-1" },
  });
});

test("non-session models and fields are not hashed", async () => {
  const { base, calls } = fakeAdapter();
  const adapter = wrapSessionTokens(base, hash);

  await adapter.create({
    model: "user",
    data: { token: "not-a-session" },
  } as never);
  await adapter.findOne({
    model: "account",
    where: where("token", "provider-token"),
  } as never);

  expect(calls[0]?.args).toEqual({
    model: "user",
    data: { token: "not-a-session" },
  });
  expect(calls[1]?.args).toEqual({
    model: "account",
    where: where("token", "provider-token"),
  });
});

test("session lookups, updates, and deletes use the stored hash", async () => {
  const { base, calls } = fakeAdapter();
  const adapter = wrapSessionTokens(base, hash);

  await adapter.findOne({
    model: "session",
    where: where("token", "raw-session"),
  } as never);
  await adapter.findMany({
    model: "session",
    where: where("token", "raw-session"),
  } as never);
  await adapter.update({
    model: "session",
    where: where("token", "raw-session"),
    update: { token: "rotated-session", expiresAt: new Date(0) },
  } as never);
  await adapter.updateMany({
    model: "session",
    where: where("token", "raw-session"),
    update: { token: "rotated-session" },
  } as never);
  await adapter.delete({
    model: "session",
    where: where("token", "raw-session"),
  } as never);
  await adapter.deleteMany({
    model: "session",
    where: where("token", "raw-session"),
  } as never);
  await adapter.consumeOne!({
    model: "session",
    where: where("token", "raw-session"),
  } as never);

  const hashedWhere = where("token", "hashed:raw-session");
  expect(calls[0]?.args).toEqual({ model: "session", where: hashedWhere });
  expect(calls[1]?.args).toEqual({ model: "session", where: hashedWhere });
  expect(calls[2]?.args).toEqual({
    model: "session",
    where: hashedWhere,
    update: { token: "hashed:rotated-session", expiresAt: new Date(0) },
  });
  expect(calls[3]?.args).toEqual({
    model: "session",
    where: hashedWhere,
    update: { token: "hashed:rotated-session" },
  });
  expect(calls[4]?.args).toEqual({ model: "session", where: hashedWhere });
  expect(calls[5]?.args).toEqual({ model: "session", where: hashedWhere });
  expect(calls[6]?.args).toEqual({ model: "session", where: hashedWhere });
});

test("transaction adapters hash session token queries too", async () => {
  const { base, calls } = fakeAdapter();
  const adapter = wrapSessionTokens(base, hash);

  await adapter.transaction(async (transaction) => {
    await transaction.findOne({
      model: "session",
      where: where("token", "raw-session"),
    } as never);
    return "done";
  });

  expect(calls.at(-1)).toEqual({
    method: "findOne",
    args: {
      model: "session",
      where: where("token", "hashed:raw-session"),
    },
  });
});

test("the session token hasher is keyed, deterministic, and preserves stored hashes", () => {
  const first = createSessionTokenHasher("secret-one");
  const second = createSessionTokenHasher("secret-two");
  const stored = "a".repeat(64);

  expect(first("session-token")).toHaveLength(64);
  expect(first("session-token")).toBe(first("session-token"));
  expect(first("session-token")).not.toBe(second("session-token"));
  expect(first(stored)).toBe(stored);
});
