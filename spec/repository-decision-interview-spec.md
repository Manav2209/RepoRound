# Repository decision interviews

Implemented on `perf/interview-response-latency` following the user's request to
focus on project decisions and technologies in context. Repository duration stays
15 minutes; System Design stays 30 minutes and retains its pinned question bank.

## Preparation

- Default to diverse sampling. Initially reserve three manifest and two README
  slots, then sample implementation across services. Favor operational workflows,
  security and consumer code over tooling and repeated bootstrap wrappers.
- Reserve source/character capacity for a bounded set of local dependency reads.
  Resolve literal imports at the pinned commit; do not invent runtime call edges.
  Keep the existing 24-file, 120,000-character and per-download limits. Unsupported
  languages, large omitted files and dynamic dependencies remain coverage gaps.
- Rank bounded lexical windows around implementation anchors and operation names.
  Cover distinct files before adding second windows. This is lexical retrieval,
  not an AST or proof that an observed behavior holds for every execution path.
- Supply implementation windows to both analyzer and planner. Documentation and
  dependency declarations establish intent or declared dependencies, not behavior.
- Review each of at most four draft questions against at most two relevant
  implementation windows in parallel during preparation. This adds bounded
  preparation-only model work; each review has one attempt and a 20-second request
  limit. If a review fails, the original draft still must pass quote binding and
  structural checks. The live-answer path does not perform these extra calls.
- Prepare at most four core decisions, including the opening. Each stores a
  spoken question, observed behavior, assessment focus, optional follow-ups and
  backend-bound source references. Require a copied implementation quote and bind
  it to the actual matching excerpt rather than trusting guessed model indexes.
  Deduplicate identical questions and quoted operations. This proves source presence,
  not that every premise or proposed tradeoff is semantically correct.
  Drop structurally invalid or unsupported cards;
  fail preparation clearly if no grounded decision remains.
- Prefer source-triggered candidate topics when at least two of delivery,
  workspace access, build acceptance, workload provisioning and persistence are
  actually observed. Bind each to its operation's excerpts, rather than deriving
  the premise from a generic architecture summary. Other repositories use the
  evidence-driven planner. These patterns are bounded heuristics, not complete
  language or architecture understanding.
- The prompts separate observed behavior from inferred motivation. Avoid claiming
  ownership, necessity or optimality, technology definitions, filename recall,
  generic load questions and compound failure/detection/redesign checklists.

## Active interview

- Speak the prepared question for a new decision. Give the project summary before
  the opening; source paths and private assessment criteria are not read aloud.
- Keep one combined live assessment/proposal request. Retrieve evidence for the
  current decision and at most two candidate next objectives, plus relevant
  candidate memory. Keep the existing active-memory and completion-flush behavior.
- A follow-up addresses one specific missing detail in the current answer. A
  proposed follow-up must pass spoken-question guards and reference evidence
  overlapping the current decision; otherwise use its prepared follow-up.
- Application policy owns progression. An objective mismatch uses the prepared
  question for the selected objective without another model request. Repeats
  retain their existing control handling.
- Assess only what the question asks. Missing unrelated component responsibilities
  or failure discussion cannot alone trigger a follow-up. Allow at most one
  follow-up per decision and two overall. New plans have no extra applied block.

## Verification and limits

Regression cases cover manifest-heavy source selection, local import resolution,
implementation below long import prefixes, evidence binding, unsupported plans,
prepared questions without another model request, and question-specific follow-up
policy. Database regressions exercise prepared fallback, replay and zero active-turn
SQL. Public-repository previews use the configured model; neither source-reference
validity nor successful structured output guarantees semantic interview quality.

Manual review should check: does the evidence show the operation mentioned; is the
question about a consequential decision; does it assume an unverified motivation;
is the hypothetical different from the current arrangement; are topics distinct;
and can a candidate answer naturally within two or three minutes? Small previews
do not establish quality across repositories or preserve earlier latency results
under the changed prompts. Existing latency metrics continue to collect new data.
