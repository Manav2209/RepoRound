/** Structured, content-free evaluation job telemetry. */
export function logEvaluation(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      scope: "evaluation-worker",
      event,
      ...fields,
    }),
  );
}
