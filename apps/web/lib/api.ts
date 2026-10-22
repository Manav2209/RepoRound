import type {
  ArchitectureSnapshot,
  DesignSubmissionResult,
  DesignView,
  InterviewResult,
  InterviewView,
  ProblemSummary,
  ReportListItem,
  SessionInfo,
  TranscriptMessage,
} from "../types/interview";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 15000, ...options } = init ?? {};
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(path, {
    ...options,
    credentials: "same-origin",
    signal: options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const payload =
      body && typeof body === "object"
        ? (body as { error?: unknown; code?: unknown })
        : null;
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : `Request failed (${res.status})`;
    const code = typeof payload?.code === "string" ? payload.code : undefined;
    if (res.status === 401) redirectSafely("sign-in");
    if (res.status === 403 && code === "EMAIL_NOT_VERIFIED")
      redirectSafely("verify-email");
    throw new ApiError(message, res.status, code);
  }

  return body as T;
}

function redirectSafely(destination: "sign-in" | "verify-email"): void {
  if (typeof window === "undefined") return;
  const returnTo = window.location.pathname + window.location.search;
  window.location.replace(
    `/${destination}?returnTo=${encodeURIComponent(returnTo)}`,
  );
}

export function createInterview(githubUrl: string): Promise<InterviewView> {
  return request<InterviewView>("/api/v1/interviews", {
    method: "POST",
    body: JSON.stringify({ githubUrl }),
  });
}

export function getReports(signal?: AbortSignal): Promise<{
  reports: ReportListItem[];
}> {
  return request("/api/v1/interviews", { signal });
}

export function getInterview(
  interviewId: string,
  signal?: AbortSignal,
): Promise<InterviewView> {
  return request<InterviewView>(`/api/v1/interviews/${interviewId}`, {
    signal,
  });
}

export function getSystemDesignProblems(): Promise<{
  problems: ProblemSummary[];
}> {
  return request<{ problems: ProblemSummary[] }>(
    "/api/v1/system-design/problems",
  );
}

export function createSystemDesignInterview(
  problemId: string,
): Promise<InterviewView> {
  return request<InterviewView>("/api/v1/interviews", {
    method: "POST",
    body: JSON.stringify({ mode: "SYSTEM_DESIGN", problemId }),
  });
}

export function getDesign(
  interviewId: string,
  signal?: AbortSignal,
): Promise<DesignView> {
  return request<DesignView>(`/api/v1/interviews/${interviewId}/design`, {
    signal,
  });
}

export function submitArchitecture(
  interviewId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    snapshot: ArchitectureSnapshot;
  },
): Promise<DesignSubmissionResult> {
  return request<DesignSubmissionResult>(
    `/api/v1/interviews/${interviewId}/design/submissions`,
    {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 30000,
    },
  );
}

export function resolveDesignCheckpoint(
  interviewId: string,
  checkpointId: string,
  choice: "CONTINUE" | "EDIT",
): Promise<{ ended: boolean; status: string; deadlineAt?: string }> {
  return request(`/api/v1/interviews/${interviewId}/design/checkpoint`, {
    method: "POST",
    body: JSON.stringify({ checkpointId, choice }),
  });
}

const inFlightSessions = new Map<string, Promise<SessionInfo>>();

export function startSession(interviewId: string): Promise<SessionInfo> {
  const existing = inFlightSessions.get(interviewId);
  if (existing) return existing;
  const promise = request<SessionInfo>(
    `/api/v1/interviews/${interviewId}/session`,
    { method: "POST" },
  ).finally(() => inFlightSessions.delete(interviewId));
  inFlightSessions.set(interviewId, promise);
  return promise;
}

export function endInterview(interviewId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v1/interviews/${interviewId}/end`, {
    method: "POST",
  });
}

export function getResult(interviewId: string): Promise<InterviewResult> {
  return request<InterviewResult>(`/api/v1/interviews/${interviewId}/result`);
}

export function getTranscript(
  interviewId: string,
): Promise<TranscriptMessage[]> {
  return request(`/api/v1/interviews/${interviewId}/transcript`);
}

export function retryEvaluation(
  interviewId: string,
): Promise<{ status: string }> {
  return request(`/api/v1/interviews/${interviewId}/evaluation/retry`, {
    method: "POST",
  });
}
