import { expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

test("signed-out visitors are sent to sign-in with their intended practice page", () => {
  const response = proxy(
    new NextRequest("http://localhost:3000/practice?mode=system-design"),
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "http://localhost:3000/sign-in?returnTo=%2Fpractice%3Fmode%3Dsystem-design",
  );
});

test("a stale session cookie cannot prevent access to sign-in", () => {
  const response = proxy(
    new NextRequest("http://localhost:3000/sign-in", {
      headers: { cookie: "reporound.session_token=stale" },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.has("location")).toBe(false);
});
