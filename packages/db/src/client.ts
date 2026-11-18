import { PrismaClient } from "../generated/client/index.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.RUN_DB_TESTS === "1" ||
      process.env.DATABASE_QUERY_EVENTS === "1"
        ? [{ emit: "event", level: "query" }, "error"]
        : process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export function isPrismaError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as { code?: unknown }).code === "string"
  );
}
