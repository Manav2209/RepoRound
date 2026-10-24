import { afterEach, expect, spyOn, test } from "bun:test";
import {
  ApiError,
  getInterview,
  getReports,
  getSystemDesignProblems,
  submitArchitecture,
} from "./api";

let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

function mockFetch(
  implementation: (
    ...args: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch>,
) {
  fetchMock?.mockRestore();
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(implementation, { preconnect() {} }),
  );
}

afterEach(() => {
  fetchMock?.mockRestore();
});

test("API requests use same-origin cookies instead of a bearer token", async () => {
  mockFetch(async (_url, init) => {
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    return Response.json({ problems: [{ id: "url-shortener" }] });
  });

  const result = await getSystemDesignProblems();
  expect(result.problems[0]?.id).toBe("url-shortener");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("account reports use the current browser session", async () => {
  mockFetch(async (url, init) => {
    expect(url).toBe("/api/v1/interviews");
    expect(init?.credentials).toBe("same-origin");
    return Response.json({
      reports: [
        {
          interviewId: "report-1",
          mode: "SYSTEM_DESIGN",
          title: "Notification System",
          score: 82,
          completedAt: "2026-10-22T00:00:00.000Z",
        },
      ],
    });
  });
  const { reports } = await getReports();
  expect(reports[0]?.title).toBe("Notification System");
});

test("a missing session is surfaced as a 401 without a renewal bootstrap", async () => {
  mockFetch(async () =>
    Response.json(
      { error: "Authentication required", code: "UNAUTHENTICATED" },
      { status: 401 },
    ),
  );

  await expect(getSystemDesignProblems()).rejects.toMatchObject({
    name: "ApiError",
    status: 401,
    code: "UNAUTHENTICATED",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("an interview ownership error preserves the request error", async () => {
  mockFetch(async () =>
    Response.json({ error: "Interview not found" }, { status: 404 }),
  );

  await expect(getInterview("unowned")).rejects.toBeInstanceOf(ApiError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("unverified email errors retain the machine-readable code", async () => {
  mockFetch(async () =>
    Response.json(
      { error: "Verify your email", code: "EMAIL_NOT_VERIFIED" },
      { status: 403 },
    ),
  );

  await expect(getSystemDesignProblems()).rejects.toMatchObject({
    status: 403,
    code: "EMAIL_NOT_VERIFIED",
  });
});

test("architecture requests survive 20 seconds and enforce their own 30-second timeout", async () => {
  const timers: Array<{ milliseconds: number; controller: AbortController }> =
    [];
  const clock = spyOn(AbortSignal, "timeout").mockImplementation(
    (milliseconds) => {
      const controller = new AbortController();
      timers.push({ milliseconds, controller });
      return controller.signal;
    },
  );
  const advanceTo = (milliseconds: number) => {
    for (const timer of timers)
      if (timer.milliseconds <= milliseconds)
        timer.controller.abort(new DOMException("Timed out", "TimeoutError"));
  };
  const input = {
    requestId: "synthetic-id",
    expectedRevision: 0,
    snapshot: { schemaVersion: 1, nodes: [], edges: [] },
  } as Parameters<typeof submitArchitecture>[1];
  try {
    mockFetch(async (_url, init) => {
      advanceTo(20000);
      init?.signal?.throwIfAborted();
      return Response.json({ submissionId: "s1", revision: 1 });
    });
    expect((await submitArchitecture("i1", input)).submissionId).toBe("s1");
    expect(timers.map((t) => t.milliseconds)).toEqual([30000]);
    mockFetch(async (_url, init) => {
      advanceTo(30000);
      init?.signal?.throwIfAborted();
      return Response.json({});
    });
    await expect(submitArchitecture("i1", input)).rejects.toMatchObject({
      name: "TimeoutError",
    });
  } finally {
    clock.mockRestore();
  }
});

test("ordinary requests keep 15 seconds and honor caller cancellation", async () => {
  const timeouts: number[] = [];
  const clock = spyOn(AbortSignal, "timeout").mockImplementation(
    (milliseconds) => {
      timeouts.push(milliseconds);
      return new AbortController().signal;
    },
  );
  try {
    const controller = new AbortController();
    mockFetch(async (_url, init) => {
      controller.abort(new DOMException("Cancelled", "AbortError"));
      init?.signal?.throwIfAborted();
      return Response.json({});
    });
    await expect(getInterview("i1", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(timeouts).toEqual([15000]);
  } finally {
    clock.mockRestore();
  }
});
