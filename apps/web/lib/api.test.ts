import { afterEach, expect, spyOn, test } from "bun:test";
import { ApiError, getInterview, getSystemDesignProblems } from "./api";

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

function mockFetch(
  implementation: (
    ...args: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch>,
) {
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(implementation, { preconnect() {} }),
  );
}

function storage(token = "old-token") {
  const values = new Map<string, string>([["interview-access", token]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

afterEach(() => {
  fetchMock?.mockRestore();
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("a saved token rejected after a database reset is renewed and the catalog loads", async () => {
  const saved = storage();
  const calls: { path: string; authorization: string | null }[] = [];
  mockFetch(async (url, init) => {
    calls.push({
      path: String(url),
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (String(url).endsWith("/auth/session"))
      return Response.json({ token: "new-token" }, { status: 201 });
    if (new Headers(init?.headers).get("Authorization") === "Bearer old-token")
      return Response.json(
        { error: "Access session expired" },
        { status: 401 },
      );
    return Response.json({ problems: [{ id: "url-shortener" }] });
  });
  const result = await getSystemDesignProblems();
  expect(result.problems[0]?.id).toBe("url-shortener");
  expect(saved.get("interview-access")).toBe("new-token");
  expect(calls).toHaveLength(3);
  expect(calls[2]?.authorization).toBe("Bearer new-token");
});

test("rejected fresh sessions stop after one renewal", async () => {
  storage();
  let bootstraps = 0;
  mockFetch(async (url) => {
    if (String(url).endsWith("/auth/session")) {
      bootstraps++;
      return Response.json({ token: "new-token" });
    }
    return Response.json({ error: "Access session expired" }, { status: 401 });
  });
  await expect(getSystemDesignProblems()).rejects.toBeInstanceOf(ApiError);
  expect(bootstraps).toBe(1);
});

test("an interview ownership error preserves the current browser identity", async () => {
  const saved = storage();
  mockFetch(async () =>
    Response.json({ error: "Interview not found" }, { status: 404 }),
  );
  await expect(getInterview("unowned")).rejects.toBeInstanceOf(ApiError);
  expect(saved.get("interview-access")).toBe("old-token");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("simultaneous rejected requests share a single replacement session", async () => {
  storage();
  let bootstraps = 0;
  mockFetch(async (url, init) => {
    if (String(url).endsWith("/auth/session")) {
      bootstraps++;
      return Response.json({ token: "new-token" });
    }
    if (new Headers(init?.headers).get("Authorization") === "Bearer old-token")
      return Response.json(
        { error: "Access session expired" },
        { status: 401 },
      );
    return Response.json({ problems: [] });
  });
  await Promise.all([getSystemDesignProblems(), getSystemDesignProblems()]);
  expect(bootstraps).toBe(1);
});
