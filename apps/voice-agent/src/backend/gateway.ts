import { customAlphabet } from "nanoid";
const random = customAlphabet("0123456789abcdefghjkmnpqrstuvwxyz", 16);
export const newEventId = () => `evt_${random()}`;
export const newTurnId = () => `turn_${random()}`;
export interface InterviewContextResponse {
  interviewId: string;
  sessionId?: string;
  githubContext: {
    repository: { owner: string; name: string };
    projectSummary: string;
  } | null;
}
export interface RealtimeEventInput {
  eventId: string;
  interviewId: string;
  sessionId: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
export interface QuestionResponse {
  ended: boolean;
  questionId?: string;
  question?: string;
  deadlineAt?: string;
}
export class BackendGateway {
  private readonly baseUrl: string;
  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          signal: AbortSignal.timeout(14000),
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
            ...(init?.headers ?? {}),
          },
        });
        if (!res.ok) {
          if (res.status < 500 && res.status !== 429)
            throw new BackendRequestError(res.status);
          lastError = new Error(
            `Backend temporarily unavailable (${res.status})`,
          );
        } else return (await res.json()) as T;
      } catch (err) {
        if (err instanceof BackendRequestError) throw err;
        lastError = err;
      }
      if (attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
    throw lastError;
  }
  private validateQuestion(value: QuestionResponse): QuestionResponse {
    if (
      typeof value.ended !== "boolean" ||
      (!value.ended &&
        (typeof value.question !== "string" ||
          !value.question.trim() ||
          value.question.length > 500 ||
          typeof value.questionId !== "string"))
    )
      throw new Error("Invalid backend question response");
    return value;
  }
  fetchInterviewContext(
    interviewId: string,
    sessionId: string,
  ): Promise<InterviewContextResponse> {
    return this.request(
      `/internal/context/${interviewId}?sessionId=${encodeURIComponent(sessionId)}`,
    );
  }
  postRealtimeEvent(event: RealtimeEventInput): Promise<{ outcome: string }> {
    return this.request("/internal/realtime/events", {
      method: "POST",
      body: JSON.stringify(event),
    });
  }
  async startInterview(
    interviewId: string,
    sessionId: string,
  ): Promise<QuestionResponse> {
    return this.validateQuestion(
      await this.request(`/internal/interviews/${interviewId}/start`, {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      }),
    );
  }
  async processTurn(
    interviewId: string,
    sessionId: string,
    turnId: string,
    questionId: string,
    text: string,
  ): Promise<QuestionResponse> {
    return this.validateQuestion(
      await this.request(`/internal/interviews/${interviewId}/turns`, {
        method: "POST",
        body: JSON.stringify({ sessionId, turnId, questionId, text }),
      }),
    );
  }
  status(interviewId: string, sessionId: string): Promise<{ ended: boolean }> {
    return this.request(
      `/internal/interviews/${interviewId}/status?sessionId=${encodeURIComponent(sessionId)}`,
    );
  }
  pendingQuestion(
    interviewId: string,
    sessionId: string,
  ): Promise<
    QuestionResponse & {
      phase?: string | null;
      checkpoint?: boolean;
    }
  > {
    return this.request(
      `/internal/interviews/${interviewId}/pending?sessionId=${encodeURIComponent(sessionId)}`,
    );
  }
}
export class BackendRequestError extends Error {
  constructor(readonly status: number) {
    super(`Backend request rejected (${status})`);
  }
}
