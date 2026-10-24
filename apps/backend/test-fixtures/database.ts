import { randomUUID } from "node:crypto";
import { prisma } from "@repo/db";

export async function createTestUser(): Promise<string> {
  const id = `user-${randomUUID()}`;
  await prisma.user.create({
    data: {
      id,
      name: "Test user",
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });
  return id;
}
