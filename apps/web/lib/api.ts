import type {
  ArchitectureSnapshot,
  DesignSubmissionResult,
  DesignView,
  InterviewResult,
  InterviewView,
  ProblemSummary,
  SessionInfo,
} from "../types/interview";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080"
).replace(/\/$/, "");
let accessPromise: Promise<string> | null = null;
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
async function accessToken(): Promise<string> {
  const saved = localStorage.getItem("interview-access");
  if (saved) return saved;
  if (!accessPromise)
    accessPromise = fetch(`${BASE_URL}/api/v1/auth/session`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
    })
      .then(async (res) => {
        if (!res.ok)
          throw new Error("Unable to create an interview access session");
        const data = (await res.json()) as { token: string };
        localStorage.setItem("interview-access", data.token);
        return data.token;
      })
      .finally(() => {
        accessPromise = null;
      });
  return accessPromise;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  renewAccess = true,
): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401 && renewAccess) {
    // Local databases can be replaced while browsers retain their old token.
    // Only discard the rejected token; another request may have renewed it.
    if (localStorage.getItem("interview-access") === token)
      localStorage.removeItem("interview-access");
    await res.body?.cancel();
    return request<T>(path, init, false);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message =
      (body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : null) ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}

export function createInterview(githubUrl: string): Promise<InterviewView> {
  return request<InterviewView>("/api/v1/interviews", {
    method: "POST",
    body: JSON.stringify({ githubUrl }),
  });
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
      signal: AbortSignal.timeout(30000),
    },
  );
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
): Promise<import("../types/interview").TranscriptMessage[]> {
  return request(`/api/v1/interviews/${interviewId}/transcript`);
}
export function retryEvaluation(
  interviewId: string,
): Promise<{ status: string }> {
  return request(`/api/v1/interviews/${interviewId}/evaluation/retry`, {
    method: "POST",
  });
}
