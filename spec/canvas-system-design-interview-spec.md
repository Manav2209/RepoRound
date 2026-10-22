# Canvas system-design interview

**Status:** Implemented locally; live voice walkthrough still pending
**Updated:** 22 October 2026  
**Scope:** The separate System Design practice mode, from problem selection through evaluation

This spec replaces the canvas interview sequence, single-revision limit, and 30-minute duration proposed in `final-interviewer-spec.md`. It does not change the GitHub repository interview or the storage and retention decisions in `interview-memory-postgres-falkordb-spec.md`. Keep the existing account ownership, LiveKit transport, immutable submitted snapshots, retry safety, and grounded evaluation requirements.

## 1. Product contract

A candidate chooses one of the **current prepared system-design problems**, sees its load and conditions stated plainly, draws an architecture, and submits it. The interviewer asks **two or three substantive questions about the submitted diagram**. After answering each, the candidate can edit and submit a new diagram revision or continue with the current one. The last question is the problem's existing failure scenario; the candidate can explain the response and optionally make a final revision. Keep the level around SD2–SD3: practical component choices, bottlenecks, tradeoffs, and failure handling, without turning a short practice session into a detailed capacity-planning exercise. There is no single required technology stack or ideal graph.

Aim to finish the **whole practice session, including initial drawing**, in roughly 10–15 minutes. Fifteen minutes is a pacing target: stop introducing optional probes when little time remains, but do not cut off a candidate mid-answer or discard a submitted revision. A reconnect or transient service delay must not silently consume the candidate's remaining time. This timing contract is independent of the repository-mode interview.

## 2. Current behavior and gap

Today the candidate chooses from ten prepared problems and draws in a React Flow canvas using ten fixed component kinds with editable labels. A valid submission has at least two nodes and one directed edge. PostgreSQL stores an immutable snapshot; FalkorDB stores a derived graph. Voice begins only when the graph is ready. The interviewer asks for the main flow, chooses up to three deterministic probes from component kinds and edges, then issues the problem's prepared failure challenge. The candidate may submit **one** revision at that point. After revision review or a verbal refusal, the session ends. The shared interview timer defaults to 30 minutes.

This is a workable baseline, but it does not evaluate a spoken answer before selecting the next canvas probe; ordinary probes do not offer a revision checkpoint. The only permitted revision is after the failure challenge. The final evaluator receives the transcript and component labels/counts, but not the submitted edges or a precise revision diff. The current notification problem names an average daily load in a clarification answer; that load is not visible in the initial prompt.

## 3. Problem authoring contract

Keep the existing ten problem titles, core briefs, visible requirements, and failure challenges. Clarify the **same questions** before drawing by displaying:

- The product objective and user-visible functional requirements.
- One concrete load assumption with units and, where useful, a simple peak assumption. Existing clarification answers should become visible when they define the intended scale; add only the minimum missing assumption needed to make the question answerable.
- The existing latency, reliability, consistency, or functional constraints relevant to that problem, in plain language. Do not invent a set of strict service-level targets for every problem.
- Existing boundary conditions that matter to the design, such as client retries, user preferences, or external provider instability.
- Permission to state reasonable missing assumptions and choose alternative architectures. Do not reveal a model answer or prescribe a queue, database, or cloud vendor in the prompt.

Keep the visible brief short enough to read quickly. The current fixed failure challenge is held until the final phase; the initial prompt may state that dependencies can fail without revealing the precise incident. Version each problem's prompt and assumptions so a report can be evaluated against what the candidate actually saw. The added load must be plausible and consistent with the existing question; it should not make the question materially harder.

### Worked example: production notification service

> Design a service that accepts notification requests and delivers email, SMS, and push notifications. Assume about **one million requests per day**, with short peaks around **200 requests per second**. Requests should be accepted quickly, delivery should happen asynchronously, and temporary provider failures and duplicate requests should be handled reasonably.
>
> Draw the main components and the direction of the data flow. Show how requests are accepted, routed to a channel, and delivered. State any additional assumptions and be ready to explain your choices.

This is the existing notification-system question with its intended scale surfaced and a modest peak made explicit, not a new harder problem. The load shapes the discussion, but the candidate does not need to calculate exact infrastructure capacity. Good alternatives are acceptable when the candidate explains the consequences.

## 4. Session sequence and time budget

1. **Choose and draw (target 3–4 minutes).** Show the problem, targets, and a visible remaining-time indicator. The candidate creates any reasonable architecture and submits revision 1. Draft canvas changes stay local; the agent does not observe them. A diagram need not look polished to be valid.
2. **Explain the submitted design (about 1 minute).** Ask the candidate to trace a representative request through the actual submitted components. This explanation counts as the first of two or three diagram questions, rather than adding an unbounded introduction.
3. **Probe and optionally revise (about 4–6 minutes).** Ask one or two further questions that test the design against the stated load and requirements, selected from actual topology and earlier answers. After **every** answered question, offer `Update diagram` and `Continue with current diagram`. If the candidate updates, save a new immutable revision, compare it with the prior one, and use the newly submitted revision for subsequent questions. Continue without penalty when they choose not to edit.
4. **Failure scenario (about 2–3 minutes).** Ask the prepared incident as the **last substantive question**. Ask what breaks, what remains safe, how the system recovers, and what tradeoff their response introduces. Offer a final optional edit; accept an explanation without an edit. End after the response and any final revision are recorded. Do not return to routine probes afterward.
5. **Report.** Show evaluation pending immediately, then produce the grounded report asynchronously. Drawing and speaking both count toward the session; report generation does not.

Prefer two strong diagram questions over a rushed third. Do not require a revision or an extra question merely to fill the budget. If a candidate answers quickly, use the third diagram question for a distinct concern. If a candidate is still making a meaningful edit near the target end, let that submission finish and end gracefully. A product-level time budget must be visible and enforced by backend state, not only by browser timers.

## 5. Question selection and answer assessment

The backend chooses the next action; the LLM may phrase a selected question but may not alter the sequence, claim that an edge proves runtime behavior, or advance beyond the final challenge. Before each question, load the active immutable snapshot and its scoped graph projection. Derive a bounded set of candidate-specific observations: components, directed paths, disconnected elements, relevant dependencies, and changes from the previous revision. Do not treat a missing box as proof that the candidate has no plan; ask for clarification.

For each answer, record whether it addressed the specific question, what guarantee or tradeoff the candidate claimed, any unresolved assumption, and the exact turn that supports the observation. Use this lightweight assessment to choose a **single targeted clarification** when an answer is vague or internally inconsistent, subject to the remaining time. A clarification is not an additional mandatory diagram question. Avoid trivia and generic prompts such as “How does it work?” when a concrete submitted path exists. Never assert a candidate's intent from topology alone.

For the worked notification example, suitable SD2–SD3 questions after inspecting a diagram might be:

1. “Trace one request from the API to a provider. At which point can you safely tell the caller it was accepted, and what survives a worker restart?”
2. “At the stated peak, which part of your design would slow down first, and what would you change?”
3. If time and diagram warrant it: “A client retries the same request while a provider call times out. What duplicates are possible in your design, and which guarantee can you actually provide?”

The interviewer should reference the candidate's actual component names and arrows when known. These are **examples**, not fixed questions asked regardless of the submission. Do not repeat a concern already answered well. Select distinct, practical dimensions across the session: request/data flow, a likely bottleneck or delivery tradeoff, and the final failure response. Do not ask for numerical capacity calculations unless the candidate chooses to use them.

## 6. Edit checkpoints and revision semantics

An edit checkpoint follows every diagram question, including the first explanation and the final failure challenge. The candidate explicitly chooses to continue or edit. Editing occurs in the interview room while the voice connection remains mounted; the interviewer waits rather than filling silence with repeated prompts. Draft changes remain invisible to the backend until `Submit revision`. `Continue` preserves the current active revision. The candidate may also say they will not change the diagram and proceed.

Revision numbers are monotonic and not limited to two; the number of possible submissions is bounded by the number of checkpoints plus the initial submission. Each accepted submission has a stable request ID, expected revision, normalized snapshot, and immutable PostgreSQL record. A retry of the same submission returns the same result. A stale or competing submission cannot replace a newer active revision. Publish the new active revision only after validation and any required graph processing; preserve the previous ready revision on failure. Questions, answers, and report evidence refer to the **specific revision active when they were asked**, so an edit never rewrites history.

Compute a structured before/after diff of nodes **and edges**, including added, removed, relabeled, and reconnected elements. Ask why a material change helps, but do not assume it does. No-op resubmission should not create a fake improvement or consume time on a revision-review question. If graph processing is delayed, the interviewer can use the canonical PostgreSQL snapshot for safe bounded inspection; FalkorDB remains a derived index, not the only copy of the design. Keep graph operations scoped to interview and submission. A graph outage must not lose a valid diagram or move the interview to an unverified revision.

Freeform custom component types are a separate canvas-editor improvement discussed earlier. They are not required to deliver this interview-flow change; the current palette and editable labels can remain for this spec. The interviewer must not treat the palette's broad categories as proof of precise runtime behavior.

## 7. Final failure question and evaluation

Each problem has one prepared, production-realistic failure incident that changes the conditions without changing the functional goal. For the example: “Your SMS provider is unavailable for 30 minutes during peak traffic. What happens to accepted SMS requests, and how would you change or operate your design to recover without a burst of duplicates?” The prompt asks for behavior and mitigation; it does not demand a particular queue or retry algorithm. The candidate may revise the diagram after answering. If there is too little time for a redraw, their spoken response remains assessable.

The final evaluator receives the versioned problem and constraints, ordered question/answer turns, all accepted revision snapshots or a faithful bounded representation of **nodes and directed edges**, the changes between revisions, the active revision for each question, and the final incident response. Assess whether the design plausibly meets the stated load and targets, whether the candidate explains component responsibilities and tradeoffs, whether changes address identified issues, and how the failure response handles durability, backpressure, recovery, and duplicates. Ground every finding in a candidate answer and/or a specific submitted revision. A diagram alone does not prove understanding; an absent box does not establish an error when the candidate explained an equivalent mechanism. Do not penalize a candidate merely for choosing `Continue` instead of editing.

The account-owned final report and post-evaluation deletion policy follow `interview-memory-postgres-falkordb-spec.md`; keep exact temporary turns and snapshots until evaluation and retries have finished. Do not store live drafts in FalkorDB or Markdown files.

## 8. Implementation order and acceptance checks

1. Keep the current problem bank and failure challenges. Surface each problem's intended load and key existing constraints in the initial brief; add only a small missing peak assumption where needed. Update the catalog, problem view, and session timer without altering GitHub mode.
2. Extend the backend-owned system-design state machine with diagram-question count, answer assessment, per-question edit checkpoints, optional clarification, active revision per question, and final-challenge completion. Keep turn deduplication and reconnect recovery deterministic.
3. Generalize submission validation and UI from one optional revision to checkpoint-scoped revisions. Keep immutable PostgreSQL snapshots and safe publication; update graph projection and revision diffing for every accepted revision.
4. Make probe selection use the current revision plus the latest assessed answer. Add a bounded fallback from canonical snapshot when the graph is stale or unavailable. Phrase one concise question at a time.
5. Pass complete, bounded topology and revision history to evaluation; check that citations identify actual turns/revisions and that report generation still works after a retry.
6. Keep the palette for this release and verify that the interviewer does not overinterpret renamed fixed kinds. Track freeform component creation as a separate editor decision.

Acceptance scenarios: a candidate can submit an initial diagram, answer one question, revise, then receive a second question grounded in the **new** diagram; a candidate can skip every edit and still complete; a weak answer receives at most a targeted, time-budgeted clarification; a duplicate submission or repeated voice turn does not create another revision/question; a graph outage or reconnect preserves the active design and session progress; the final failure question is last; the report distinguishes actual topology changes from verbal claims and cites the evidence used; and typical sessions finish near 10–15 minutes without dropping a candidate's in-progress answer or revision. The backend and graph integration scenarios pass locally. A complete browser-and-voice walkthrough is still required before deployment.
