import { expect, test } from "bun:test";
import { loadConfig } from "./config.js";
import {
  DEFAULT_SYSTEM_DESIGN_DURATION_MINUTES,
  SYSTEM_DESIGN_MAIN_QUESTIONS,
} from "./system-design/policy.js";

const required: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AI_ROUTER_BASE_URL: "https://model.example.test/v1",
  AI_ROUTER_API_KEY: "test",
  AI_ROUTER_MODEL: "test-model",
  LIVEKIT_URL: "wss://voice.example.test",
  LIVEKIT_API_KEY: "test",
  LIVEKIT_API_SECRET: "test-secret",
  INTERNAL_API_TOKEN: "test-token",
  BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-characters",
};

test("system design defaults to 30 minutes while repository rounds remain 15", () => {
  const config = loadConfig(required);
  expect(config.SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES).toBe(30);
  expect(config.GITHUB_INTERVIEW_DURATION_MINUTES).toBe(15);
  expect(DEFAULT_SYSTEM_DESIGN_DURATION_MINUTES).toBe(30);
  expect(SYSTEM_DESIGN_MAIN_QUESTIONS).toBe(3);
});

test("system design accepts the new limit and preserves explicit older settings", () => {
  expect(
    loadConfig({ ...required, SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES: "30" })
      .SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES,
  ).toBe(30);
  expect(
    loadConfig({ ...required, SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES: "15" })
      .SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES,
  ).toBe(15);
});

test("system design does not permit unbounded interview lengths", () => {
  for (const duration of ["9", "31", "30.5"])
    expect(() =>
      loadConfig({
        ...required,
        SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES: duration,
      }),
    ).toThrow("SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES");
});

test("the longer system design setting cannot extend repository interviews", () => {
  expect(() =>
    loadConfig({ ...required, GITHUB_INTERVIEW_DURATION_MINUTES: "30" }),
  ).toThrow("GITHUB_INTERVIEW_DURATION_MINUTES");
});
