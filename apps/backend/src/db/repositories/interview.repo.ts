import {
  type Interview,
  type InterviewStatus,
  type Prisma,
  prisma,
} from "@repo/db";

export type InterviewWithContext = Prisma.InterviewGetPayload<{
  include: { knowledge: { select: { facts: true } }; interviewPlan: true };
}>;

export interface CreateInterviewInput {
  id: string;
  githubUrl: string;
  owner: string;
  name: string;
  userId: string;
}

export interface UpdateInterviewStatusInput {
  status: InterviewStatus;
  error?: string;
}

export class InterviewRepo {
  async create(input: CreateInterviewInput): Promise<Interview> {
    return prisma.interview.create({ data: input });
  }

  async getById(id: string): Promise<Interview | null> {
    return prisma.interview.findUnique({ where: { id } });
  }

  async getWithContext(id: string): Promise<InterviewWithContext | null> {
    return prisma.interview.findUnique({
      where: { id },
      include: { knowledge: { select: { facts: true } }, interviewPlan: true },
    });
  }

  async updateStatus(
    id: string,
    input: UpdateInterviewStatusInput,
  ): Promise<Interview> {
    return prisma.interview.update({
      where: { id },
      data: {
        status: input.status,
        error: input.error,
        startedAt: input.status === "active" ? new Date() : undefined,
        completedAt:
          input.status === "completed" || input.status === "failed"
            ? new Date()
            : undefined,
      },
    });
  }

  async markReady(id: string): Promise<Interview> {
    return prisma.interview.update({
      where: { id },
      data: {
        status: "ready",
        error: null,
        completedAt: null,
      },
    });
  }
}

export const interviewRepo = new InterviewRepo();
