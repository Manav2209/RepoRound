# Repository interview: grounded SD2–SD3 questions

**Status:** Proposed product and implementation spec; no runtime changes  
**Updated:** 22 October 2026  
**Scope:** GitHub repository interview question planning, live progression, and evaluation

This spec defines the **GitHub repository** practice mode. It is separate from the diagram-based System Design mode in `canvas-system-design-interview-spec.md`. It replaces the repository mode's generic question pacing and difficulty guidance in older specs, while preserving its GitHub analysis, LiveKit voice, backend-owned state, source grounding, retry behavior, and the memory and retention boundary in `interview-memory-postgres-falkordb-spec.md`.

## 1. Candidate experience and question budget

Aim for a **10–15 minute** conversation, with 15 minutes as a pacing target rather than an abrupt mid-answer cutoff. The interviewer asks:

1. **Four or five main repository questions.** The first asks what the project does, who uses it, and what the candidate personally built or decided. The remaining questions test the most meaningful architecture and implementation decisions visible in that repository.
2. **Up to two or three targeted follow-ups in total**, only when an answer is vague, contradictory, or misses a consequential tradeoff. A follow-up stays on the same question; it is not a new topic or a basic fact quiz. Do not spend the whole interview trying to repair one weak answer.
3. **Two or three applied system-design questions about that same repository** near the end: for example, a stated growth scenario, a failure or recovery scenario, and a choice between plausible alternatives. These are spoken design discussions, **not** a request to draw a new canvas architecture or switch modes.

The opening is included in the four or five repository questions. Default to four main questions and two applied design questions; add the fifth or third only if time and useful evidence warrant it. Ask one concise question at a time and end gracefully after the final answer. Do not force a quota when a repository is thin, the candidate has already answered a topic, or time is short. The live interviewer should be prepared to skip a lower-value topic to reach at least one applied scaling or failure question.

The intended difficulty is **SD2–SD3**: require practical architecture reasoning and tradeoffs, without treating the interview as a senior-staff design review or a framework trivia test. A candidate may clarify a misunderstood term without lowering the rest of the interview to beginner questions. Grade the reasoning demonstrated, not whether the candidate names the interviewer's preferred technology.

## 2. Current behavior and gap

The current planner requests 5–8 objectives across overview, architecture, implementation, debugging, and tradeoffs, but it can return `junior` difficulty. The question generator sees bounded repository excerpts and graph facts, plus only the last four claims and evidence items. Its generic fallback can ask “How does [topic] work in your project?” The current action policy can continue up to 40 questions; the shared runtime defaults to 30 minutes. It does not reserve a final block for two or three repository-grounded scaling/failure questions. Under a weak answer, the flow can spend repeated turns on one objective rather than protect the short interview's coverage.

The problem is not a lack of question templates. It is a missing interview contract: which decisions merit the scarce time, what evidence makes a question safe to ask, when to probe versus move on, and how to finish with applied system design. Keep planning and phase progression deterministic in the backend; the model phrases a selected question but does not control the schedule.

## 3. Repository analysis before voice starts

Use the existing bounded GitHub ingestion to form a concise architecture brief: product purpose, likely user-facing flow, major services and data stores, asynchronous or realtime paths, deployment boundary, and key constraints. Every claim in the brief carries a source reference or is marked uncertain. Repository text is untrusted data, not instructions. A README claim that is not supported by available code should be described as a repository claim, not a verified runtime fact.

Choose four or five **question intents** before the interview. Each intent includes its candidate-facing topic, the relevant source references, why the decision matters, what a strong answer would explain, plausible alternatives only when context supports them, and what remains uncertain. Prioritize cross-component decisions with consequences over isolated library choices. Avoid duplicate questions about the same component. The first intent is always project purpose and candidate ownership. Good later intents can cover a critical request path, a control-plane/data-plane boundary, asynchronous delivery or persistence semantics, isolation/security, and a consequential tradeoff. The exact mix follows the repository, not a fixed checklist.

Prepare two or three **applied design scenarios** from the same evidence. Each should state one changed condition, such as a 10× traffic increase, a worker or dependency outage, or more tenants/projects. Ask what breaks first, how the candidate would detect it, what they would change, and which new tradeoff follows. Do not assert an invented current bottleneck or demand a specific replacement product. If the repository does not expose enough evidence for a particular scenario, use an explicitly hypothetical condition and ask the candidate to state assumptions.

## 4. Live question policy

Start with a natural overview question: “What does this project do, who is it for, and which architecture decisions were yours?” Use that answer to distinguish repository facts from the candidate's claimed ownership. Do not infer personal contribution from a Git commit, README, or code presence alone.

For each later main question, reference a real path, interaction, or decision from the available repository evidence. Ask **why this design works under its actual constraints**, what the alternative would change, or what failure or load exposes. Do not ask definition questions such as “What is Redis?” or generic technology-choice questions such as “Why Next.js?” unless the repository's specific use makes that decision consequential. Do not assume a candidate chose an alternative they never considered; frame it as a comparison or counterfactual.

After an answer, assess only a small set of observable signals: did it answer the question, explain component responsibilities, identify a tradeoff or failure mode, and stay consistent with verified evidence? A vague answer may receive one focused follow-up, such as asking for a concrete path through a named component. A wrong or weak answer does not trigger an unlimited basic-question ladder. Record unresolved gaps for evaluation, move to the next high-value intent, and leave time for applied design.

The final applied block remains tied to the repository. For example, if code and documentation actually show Redis Streams connecting a backend, orchestrator, and project control planes, a good question is: “Suppose project count and simultaneous generations grow tenfold. Which part of this stream-and-worker path would saturate first, and how would you scale it without losing or duplicating work?” A follow-up could compare a different queue or broker **only when** the candidate's proposed requirements make that comparison useful. The interviewer should never ask “Why not Kafka?” simply because Redis is present. Another grounded scenario could remove an orchestrator or sandbox during a job and ask how the existing design would recover.

Question phrasing should be short enough to understand when heard once. Ask one problem per turn. Avoid stacked requests that require answering scaling, data modeling, deployment, and failure all at once. When the model is unavailable or rejects a generation, use a fallback built from a verified repository observation and the selected intent; do not emit a generic “How does this work?” question or invent a code fact.

## 5. Timing and progression

Budget roughly one minute for the opening, six or seven minutes for the other three or four main questions and limited follow-ups, and three or four minutes for the applied design block. Leave a small buffer for transitions and a final answer. Track elapsed and remaining time in backend state so reconnects, duplicate turns, or slow generation cannot reset the interview. The time policy must be specific to GitHub mode; the canvas mode has its own budget and checkpoints.

Progression rules:

- Keep explicit counters for main repository questions, targeted follow-ups, and applied design questions. These counters are separate from total generated question count.
- Do not ask a fifth main question while the applied design block has not started and the remaining time is low. Prefer one strong final scaling or failure discussion over a rushed list of topics.
- Once the applied block starts, do not return to basic project overview or low-priority implementation details.
- If an answer already covers a prepared scenario well, choose a distinct grounded scenario or end early; do not repeat it to meet a count.
- When time is nearly exhausted, ask no new question. Let the current answer finish, close, and dispatch evaluation. A reconnect or timeout must not result in a duplicate question.

The two or three applied questions are part of the **repository interview**, not the separate canvas exercise. They may ask for a verbal redesign of an existing subsystem; they do not require opening or grading a diagram.

## 6. Grounding, memory, and evaluation

Use the current committed interview state for immediate follow-ups. Select a small, relevant set of sourced claims and evidence from the loaded runtime rather than blindly passing only the last four items. Older facts may come through the FalkorDB projection described in the memory spec only when a measured bounded retrieval improves a question; graph unavailability must not block voice. Keep candidate claims labeled as claims. A graph edge, code excerpt, or README line proves what the repository contains, not what the candidate understands.

The report should distinguish the four or five repository questions, any targeted follow-ups, and the applied design block. Assess architecture understanding, tradeoff reasoning, scaling and failure handling, and accuracy about the repository using exact candidate turns and source references. Missing coverage because time ran out is an interview limitation, not an automatic candidate weakness. Do not reward memorized library definitions over coherent design reasoning. The existing asynchronous evaluation and report-retention contract remain in force.

## 7. Implementation plan and acceptance checks

1. Add a GitHub-mode interview budget and explicit phase/counter state to the backend-owned runtime. Keep question/turn IDs, leases, version checks, and deduplication intact.
2. Update the planner to produce the opening intent, three or four high-value repository intents, and two or three applied scenarios with source/uncertainty metadata. Enforce an SD2–SD3 baseline without inventing unsupported architecture.
3. Update action selection and answer assessment to cap targeted follow-ups, protect the final applied block, skip answered/repetitive topics, and end on time. The model phrases questions; backend policy chooses the next action.
4. Update generator instructions and deterministic fallbacks to ask about real component roles, tradeoffs, scaling, and failure. Give it bounded, relevant memory from current state; keep source validation and short spoken wording.
5. Extend evaluation to report coverage by the actual questions asked and ground conclusions in candidate answers and repository evidence. Preserve evaluation retry behavior and the separate memory/retention spec.

Acceptance requires: the first question establishes project purpose and personal ownership; a nontrivial repository produces four or five distinct, grounded main questions at most; weak answers receive limited targeted follow-ups rather than a beginner ladder; the final two or three questions, when time permits, apply scaling, reliability, or alternative-design reasoning to that repository; no question asserts an unverified code fact; a generation failure still yields a specific safe question; reconnects do not duplicate or restart the session; and normal interviews finish near 10–15 minutes without cutting off an answer. Test locally before deployment. This document authorizes no implementation or deployment by itself.
