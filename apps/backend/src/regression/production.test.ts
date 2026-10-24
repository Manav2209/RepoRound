import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// Module doubles are process-scoped in Bun. Isolate them from ordinary unit
// tests and opt-in real-DB suites, and override dotenv's datasource as well.
test("production route, publication, evaluation and retry regressions", async () => {
  const child = Bun.spawn(
    [Bun.which("bun")!, "test", "./test-fixtures/production.test.ts"],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://test:test@127.0.0.1:1/test?connect_timeout=1",
        NODE_ENV: "test",
        RUN_DB_TESTS: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0) throw new Error(stdout + stderr);
  expect(status).toBe(0);
}, 60000);
