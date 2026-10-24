import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import InterviewResult from "../components/InterviewResult";
import type { InterviewResult as Result } from "../types/interview";

const result: Result = {
  status: "completed",
  score: null,
  dimensions: {},
  strengths: [],
  weaknesses: [],
  feedback: "More evidence is needed.",
};

test("partial evaluation coverage is visible alongside the assessment", () => {
  const html = renderToStaticMarkup(
    <InterviewResult
      result={{
        ...result,
        coverage: {
          totalTurns: 50,
          includedTurns: 40,
          omittedTurns: 10,
          truncatedTurns: 12,
          quality: "partial",
        },
      }}
    />,
  );
  expect(html).toContain("Partial assessment");
  expect(html).toContain("40 of 50 recorded answers");
  expect(html).toContain("12 answers were shortened");
  expect(html).toContain("missing details are not treated as weaknesses");
});

test("existing results without coverage metadata remain readable", () => {
  const html = renderToStaticMarkup(<InterviewResult result={result} />);
  expect(html).toContain("More evidence needed");
  expect(html).not.toContain("Partial assessment");
});
