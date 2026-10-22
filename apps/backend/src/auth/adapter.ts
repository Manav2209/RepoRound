import type { DBAdapter, DBAdapterInstance } from "better-auth";
import { prisma } from "@repo/db";
import { prismaAdapter } from "better-auth/adapters/prisma";

type WhereEntry = {
  field: string;
  value: unknown;
  operator?: string;
  connector?: string;
};

type DataArgs = {
  model: string;
  data: Record<string, unknown>;
};

type WhereArgs = {
  model: string;
  where: WhereEntry[];
  update?: Record<string, unknown>;
};

export function createHashedSessionAdapter(
  hashToken: (token: string) => string,
): DBAdapterInstance {
  return (options) =>
    wrapSessionTokens(
      prismaAdapter(prisma, {
        provider: "postgresql",
        transaction: true,
      })(options),
      hashToken,
    );
}

export function wrapSessionTokens(
  base: DBAdapter,
  hashToken: (token: string) => string,
): DBAdapter {
  const hashValue = (model: string, field: string, value: unknown) =>
    model === "session" && field === "token" && typeof value === "string"
      ? hashToken(value)
      : value;

  const mapWhere = (model: string, where: WhereEntry[]) =>
    where.map((entry) => ({
      ...entry,
      value: hashValue(model, entry.field, entry.value),
    }));

  const create = base.create.bind(base);
  base.create = (async (args: DataArgs) => {
    const rawToken =
      args.model === "session" && typeof args.data.token === "string"
        ? args.data.token
        : undefined;
    const created = await create({
      ...args,
      data: rawToken ? { ...args.data, token: hashToken(rawToken) } : args.data,
    } as never);
    return rawToken
      ? ({ ...(created as Record<string, unknown>), token: rawToken } as never)
      : created;
  }) as typeof base.create;

  const findOne = base.findOne.bind(base);
  base.findOne = ((args: WhereArgs) =>
    findOne({ ...args, where: mapWhere(args.model, args.where) } as never)) as typeof base.findOne;

  const findMany = base.findMany.bind(base);
  base.findMany = ((args: WhereArgs) =>
    findMany({ ...args, where: mapWhere(args.model, args.where) } as never)) as typeof base.findMany;

  const update = base.update.bind(base);
  base.update = ((args: WhereArgs) =>
    update({
      ...args,
      where: mapWhere(args.model, args.where),
      update: hashUpdate(args.model, args.update, hashValue),
    } as never)) as typeof base.update;

  const updateMany = base.updateMany.bind(base);
  base.updateMany = ((args: WhereArgs) =>
    updateMany({
      ...args,
      where: mapWhere(args.model, args.where),
      update: hashUpdate(args.model, args.update, hashValue),
    } as never)) as typeof base.updateMany;

  const remove = base.delete.bind(base);
  base.delete = ((args: WhereArgs) =>
    remove({ ...args, where: mapWhere(args.model, args.where) } as never)) as typeof base.delete;

  const deleteMany = base.deleteMany.bind(base);
  base.deleteMany = ((args: WhereArgs) =>
    deleteMany({ ...args, where: mapWhere(args.model, args.where) } as never)) as typeof base.deleteMany;

  if (base.consumeOne) {
    const consumeOne = base.consumeOne.bind(base);
    base.consumeOne = ((args: WhereArgs) =>
      consumeOne({ ...args, where: mapWhere(args.model, args.where) } as never)) as typeof base.consumeOne;
  }

  const transaction = base.transaction.bind(base);
  base.transaction = ((callback) =>
    transaction((transactionAdapter) =>
      callback(
        wrapSessionTokens(
          {
            ...transactionAdapter,
            transaction,
          } as DBAdapter,
          hashToken,
        ),
      ),
    )) as typeof base.transaction;

  return base;
}

function hashUpdate(
  model: string,
  update: Record<string, unknown> | undefined,
  hashValue: (model: string, field: string, value: unknown) => unknown,
): Record<string, unknown> | undefined {
  if (!update || typeof update.token !== "string") return update;
  return { ...update, token: hashValue(model, "token", update.token) };
}
