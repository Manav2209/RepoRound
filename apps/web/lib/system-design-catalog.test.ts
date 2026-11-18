import { afterEach, expect, spyOn, test } from "bun:test";
import { getSystemDesignProblems } from "./api";

let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

afterEach(() => {
  fetchMock?.mockRestore();
});

test.each([30, 20])(
  "system design catalog preserves the server's %i-minute round metadata",
  async (durationMinutes) => {
    fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () =>
          Response.json({ durationMinutes, questionTarget: 3, problems: [] }),
        { preconnect() {} },
      ),
    );
    const catalog = await getSystemDesignProblems();
    expect(catalog.durationMinutes).toBe(durationMinutes);
    expect(catalog.questionTarget).toBe(3);
    expect(catalog.problems).toEqual([]);
  },
);
