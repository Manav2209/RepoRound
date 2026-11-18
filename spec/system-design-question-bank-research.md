# System design question bank: relevance and short-round scope

**Reviewed:** 18 November 2026

**Status:** Implemented policy: new system design rounds use 30 minutes, including drawing, and three core question slots. Catalog version 3 narrows requirements and makes exclusions explicit. A controlled direct-backend benchmark is recorded in `spec/benchmarks/system-design-controlled.json`; it does not establish live voice latency or production reliability.
**Scope:** All ten catalog problems, the historical proposed bank on `main`, and the updated runtime on `experiment/repository-context`. The baseline audit is preserved below and clearly separated from the final implementation decision.

## Implemented decision

All ten topics are retained because they are relevant to published system design interview practice. The required scope is narrowed, with this three-question sequence:

1. Trace the core flow in the candidate's diagram.
2. Explore one decision that is distinctive to this problem.
3. Apply one realistic failure, race, or load scenario.

The three optional middle probes in the existing proposed bank are alternatives to choose between. They are not three additional required questions. An opening, all three probes, and the final incident would produce five substantive questions.

The initial audit scoped a 15-minute exercise to two or three core requirements, one clear correctness or reliability guarantee, supplied workload assumptions, and explicit exclusions. The implemented 30-minute round keeps that focused scope rather than adding features: the additional time is for drawing, reasoning, optional revision, and voice transitions. Equivalent implementation mechanisms are acceptable. Optional features are not hidden grading requirements.

The initial research considered a 20-minute standard option. The final product decision supersedes it: **a flat 30-minute system design round with the same three core questions**, with drawing included and no 15/20-minute mode selector. GitHub repository interviews remain at their separate 15-minute default. The runtime preserves saved deadlines and problem snapshots for interviews already in progress; new configuration does not reset an old round. These are implemented scope and budget choices, not measured completion-time guarantees.

## What the sources establish

- **Official employer guidance:** [Atlassian's engineering interview handbook](https://www.atlassian.com/company/careers/resources/interviewing/engineering) describes a 60-minute system design session with structured, adaptive discussion of architecture, scale, and constraints. This establishes one employer's format; it does not make 60 minutes a universal standard.
- **Original interview-preparation guidance:** [Hello Interview's delivery framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery) prioritizes a small set of functional requirements and a working design before deeper discussion. Its problem guides below validate topic and mechanism relevance; they are not transcripts proving particular company questions.
- **First-person interview reports:** A [Zomato/Eternal candidate report](https://leetcode.com/discuss/post/8385519/) describes notification-service integration, duplicate prevention, and cooldown discussion. A [Yahoo candidate report](https://leetcode.com/discuss/post/6742009/) describes a movie-ticket booking prompt. An [Addepar candidate report](https://leetcode.com/discuss/post/6129718/) narrows ticket booking to one theater. These are anonymous self-reports, not employer verification.
- **Production engineering evidence:** [Slack's job-queue account](https://slack.engineering/scaling-slacks-job-queue/) supports durable buffering and failure isolation as meaningful discussion areas. [Uber's matching explanation](https://www.uber.com/us/en/marketplace/matching/) shows why exact nearest-driver selection and full fleet optimization are different goals. These validate mechanisms, not interview provenance.

The questions below are proposed original wording. No claim is made that these exact sentences were asked by an employer, or that the sources establish how frequently each problem is asked.

## Initial implementation audit — historical baseline

These findings describe the runtime inspected before the changes in this document were implemented. They explain the work undertaken; they are not a description of the updated behavior.

- The generated bank is `main:spec/system-design-question-bank.md`, labeled **Proposed for review**. It is absent from the current experiment branch; its merge into `main` did not implement a runtime question bank.
- `apps/backend/src/system-design/probes.ts` specializes notifications. The other nine problems use generic async, datastore-consistency, provider, and scaling probes. Their catalog incidents are problem-specific, but the middle question often is not.
- `apps/backend/src/interview/orchestrator.ts` currently chooses four substantive questions when at least 11 minutes remain at voice start, three with at least seven, and two otherwise. It does not guarantee a three-question round.
- An optional clarification and a spoken diagram checkpoint after each substantive answer add turns beyond that count. The final checkpoint adds another choice. Repeat requests are now handled separately, but the other transitions still consume time.
- The system design clock starts at interview creation, so reading and drawing use the same budget as discussion. Reconnect credit is conditional; there is no unconditional credit for first-session startup. Editing near the deadline can extend the session.
- `apps/backend/src/config.ts` currently rejects a system design duration above 15 minutes. A longer option needs a deliberate configuration and pacing change, not just a new environment value.
- `apps/backend/src/interview/strategies/system-design.ts` appends a general failure/detection/recovery question to the already specific final incident. This makes several prompts repetitive and multi-part. Its phrasing prompt asks for at most 35 words, while the runtime clamp accepts 40.
- Several evaluation goals name a preferred mechanism such as caching, queues, or a geospatial index. Grade the explained guarantees and tradeoffs instead, and do not penalize optional features that were not explored.

## Minimum briefs and three-question content rationale

The following original question sets guided the version 3 catalog and problem-specific probe bank. They stay within 35 words and 320 characters per spoken prompt and retain each problem's failure or load incident. Runtime wording can follow the active diagram or an unresolved candidate claim; the middle question may be replaced by another relevant, uncovered probe from the bank, not become a fourth required question. The catalog's explicit `outOfScope` entries implement the exclusions listed under each problem.

### 1. Notification system

**Comparison:** Relevant topic and failure scenario. The full multi-channel, preference, duplicate, and scaling brief contains more depth than one short round needs. [Comparable authored guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/notification-system).

**Minimum brief:** Accept a recipient, message, and channel; deliver asynchronously through email or SMS; preserve accepted work through a temporary provider failure. Supply the existing 1M/day and 200 RPS peak assumptions. Assume preference lookup already exists.

1. Using your diagram, trace a notification from API acceptance to provider delivery, including the point at which acceptance becomes durable.
2. A client retries after a timeout. How does your design distinguish a retry from a new notification without sending the same notification twice?
3. The SMS provider is unavailable for 30 minutes. How does your design recover accepted SMS work without overwhelming the provider when it returns?

**Defer:** Push-specific infrastructure, preference management, campaigns, schedules, quiet hours, analytics, and a separate worker-scaling deep dive. Avoid promising exactly-once third-party delivery.

### 2. URL shortener

**Comparison:** Already a good short-round fit. Creation, authoritative mapping, concurrent uniqueness, and a hot-link incident are the right core. [Comparable Bitly guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/bitly).

**Minimum brief:** Create an immutable short-code mapping and redirect correctly under read-heavy traffic. Supply the current read/write assumptions; do not require capacity arithmetic or a particular database/cache product.

1. Using your diagram, trace a link's creation and a later redirect, showing where the authoritative URL mapping is read and written.
2. Two create requests generate the same code. How does your create path choose the winning mapping without overwriting an existing link?
3. One short link receives most redirect traffic. How does your design absorb that load without overwhelming the mapping store?

**Defer:** Custom aliases, expiry, analytics, abuse detection, multi-region writes, and detailed storage sizing.

### 3. Distributed rate limiter

**Comparison:** Relevant, but “consistent across servers” needs to agree with the allowed over-admission tolerance. An outage policy should be justified rather than requiring unconditional fail-open. [Comparable authored guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/distributed-rate-limiter).

**Minimum brief:** Enforce one API-key quota with fast allow/reject decisions, a stated small race tolerance, and an explicit degraded-mode policy. Any defensible algorithm is acceptable.

1. Trace one API request through your limiter, showing which state your chosen algorithm uses to admit or reject it.
2. Two servers check the same API key concurrently. How does your design keep combined admissions within the tolerance you stated?
3. The limiter's shared state becomes unavailable. What policy does your design apply to balance continued API availability against overload protection?

**Defer:** Multiple quota tiers, rule-distribution control planes, multi-region coordination, every algorithm comparison, and implementation pseudocode.

### 4. Chat application

**Comparison:** Relevant, but mandatory direct chat, groups, presence, ordering, offline delivery, and large connection counts are too broad together. [Comparable WhatsApp guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/whatsapp).

**Minimum brief:** Single-region, one-to-one text messaging with near-real-time online delivery, durable offline retrieval, and per-conversation ordering. Global ordering is unnecessary.

1. In your diagram, how does one message move from the sender to online delivery or offline storage before the sender receives confirmation?
2. Two participants send messages concurrently in one conversation. Where does your design establish their order, and how do clients preserve it?
3. A connection server crashes with messages in flight. How do affected clients reconnect and recover missing messages without displaying duplicates?

**Defer:** Group fan-out, presence, media, read receipts, encryption architecture, multi-device sync, and cross-region routing. Do not grade omitted presence or group features in this version.

### 5. File storage

**Comparison:** Relevant; preserve one coherent upload-correctness thread instead of independently exploring storage internals, rich permissions, synchronization, and transfer protocols. [Comparable Dropbox guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/dropbox).

**Minimum brief:** Upload and authorized download of large private files; resume an interrupted transfer; expose only completed uploads. Owner-only access is sufficient. Treat blob storage as a supplied building block.

1. Using your diagram, trace a large upload and a later authorized download, showing where file bytes and metadata live.
2. An upload disconnects halfway through. How does your design identify what has already arrived so the client can resume safely?
3. Metadata exists but the upload never completes. How does your design prevent a broken download and eventually clean up the incomplete upload?

**Defer:** Folder models, rich sharing permissions, cross-device sync, collaboration, content deduplication, and blob-store internals.

### 6. Job queue

**Comparison:** Durable ownership, retries, duplicate effects, and poison-job isolation fit. The current brief also introduces scheduler concerns that can be separated. [Comparable Job Scheduler guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/job-scheduler); [production queue example](https://slack.engineering/scaling-slacks-job-queue/).

**Minimum brief:** Accept background jobs durably; execute them at least once; recover after worker failure; bound retries and isolate permanently failing work. Supply the peak-rate assumption without requiring detailed sizing.

1. Trace one job from submission through durable storage to worker acknowledgment in your diagram.
2. A worker completes its work but crashes before acknowledgment. How does your design handle the next delivery without repeating an unwanted side effect?
3. One job keeps failing. How does your design stop its retries from delaying unrelated jobs?

**Defer:** Cron, delayed execution precision, dependencies, priorities, per-key ordering, and tenant fairness. The existing repeat-execution probe is a better core second question than delayed-job scheduling.

### 7. News feed

**Comparison:** Strong topic and celebrity-post incident. Requiring both read-time and write-time fan-out prescribes an architecture instead of a user-visible outcome. [Comparable Facebook News Feed guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-news-feed).

**Minimum brief:** Assume existing users and follow relationships; publish text posts and retrieve a reverse-chronological feed. Permit a stated short publication lag and include a high-follower outlier. Candidates choose the fan-out strategy.

1. Trace what happens between publishing a post and a follower seeing it in their feed.
2. Where does your design assemble a user's feed, and what tradeoff does that create between publishing work and reading work?
3. An account with ten million followers posts. How would your design keep feed requests responsive while handling that publication?

**Defer:** Ranking, recommendation models, media processing, reactions, comments, and detailed authorization. Stable pagination is an alternate second question when fan-out has already been explained, not an extra required question.

### 8. Ride-hailing

**Comparison:** Location freshness, nearby matching, and assignment races are relevant. “Handle supply and demand imbalance” is too open-ended. The brief should prohibit conflicting assignments for both riders and drivers. [Comparable Uber guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/uber); [official matching explanation](https://www.uber.com/us/en/marketplace/matching/).

**Minimum brief:** One city; drivers publish locations every few seconds; riders request a nearby available driver; drivers accept or decline. Allow approximate nearby search and slight staleness. Permit at most one active confirmed assignment per rider and per driver.

1. Trace a ride request from the rider through an offer to a driver's confirmed acceptance.
2. How would your matcher find nearby available drivers quickly when their reported locations may be a few seconds old?
3. Two drivers accept offers for the same rider almost simultaneously. Where does your design decide which assignment succeeds?

**Defer:** Pricing, payments, route optimization, ratings, scheduled rides, and optimal fleet-wide matching. Do not require exact nearest-driver selection or a specific geospatial technology.

### 9. Video streaming

**Comparison:** Upload durability, asynchronous processing, and backlog recovery are relevant. Mandatory adaptive bitrate, multiple renditions, global delivery, and large-transfer details together are too broad for this format. [Comparable YouTube guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/youtube).

**Minimum brief:** Upload and preserve the original video; process it asynchronously; expose processing status; play a usable output when ready. Storage, encoding, and delivery services can be supplied building blocks.

1. Trace an uploaded video through storage and processing to a viewer's playback request in your diagram.
2. Where does your design decide that an uploaded video is ready for playback?
3. Uploads arrive faster than videos can be processed. How does your design control the backlog without disrupting existing playback?

**Defer:** Codec internals, detailed adaptive-bitrate manifests, live video, recommendations, search, moderation, detailed CDN topology, and resumable-upload protocols. Multiple renditions are optional depth for a longer round.

### 10. Ticket booking

**Comparison:** A particularly good fit when scoped to one known event. Holds, concurrent reservation, expiry, and no overselling provide strong signal. [Comparable Ticketmaster guide](https://www.hellointerview.com/learn/system-design/problem-breakdowns/ticketmaster); [single-theater interview report](https://leetcode.com/discuss/post/6129718/).

**Minimum brief:** A fixed seat inventory for one event; an expiring hold; booking confirmation using an external payment result; never confirm a seat twice. Event search and payment-provider internals are out of scope.

1. Trace a selected seat through a temporary hold to a confirmed booking in your diagram.
2. Two customers try to hold the same seat simultaneously. Which part of your design chooses the winner?
3. A popular event opens and traffic spikes immediately. How does your design protect inventory while keeping reservation requests responsive?

**Defer:** Dynamic pricing, discovery/search, refunds, multi-seat atomicity, sophisticated waiting-room fairness, and detailed payment compensation. Payment confirmation racing hold expiry is an alternate deep dive, not a fourth required question.

## Pacing and assessment contract

**Implemented round budget:** 30 minutes for system design, including the initial diagram, and exactly three core slots when a candidate completes the round. Repository interviews keep their own 15-minute default. There is no user-facing duration selector.

**Illustrative pacing within that budget:** 2 minutes for brief/assumptions, 7 for the initial sketch, 15 for the three discussions, and 6 shared by voice transitions, optional edits, a bounded clarification, and closing. The total runtime budget is enforced; these individual allocations are a coaching suggestion, not separate scheduler limits. Additional time does not automatically add a fourth question or restore deferred features.

These allocations need live-session validation. The intentional 10-second startup wait is excluded only from adjusted startup latency. The wait still takes wall-clock time; crediting it to an interview deadline is separate from adjusting operational metrics.

- Ask exactly three substantive questions when the candidate completes the round; if they leave or time expires, report incomplete coverage rather than inventing an answer.
- Reserve the last substantive slot for the catalog incident. At most one brief clarification should stay within the same question slot.
- Keep repeated questions and diagram choices outside the substantive count. Edits are optional silent UI checkpoints; the voice worker does not read an edit menu after every answer.
- Match the middle probe to the active diagram or an unresolved candidate claim. If its mechanism was already explained, choose another relevant probe instead of repeating it.
- When a required component is absent, ask how the candidate satisfies the guarantee; do not invent a topology fact or require a predetermined diagram.
- Assess only covered requirements and observed reasoning. Separate insufficient evidence from an incorrect mechanism. Equivalent designs and stated tradeoffs can earn credit without named products.

## Implemented changes and remaining validation

- New system design rounds default to 30 minutes, including drawing, while the GitHub duration remains 15. The supported configuration range was extended for system design; existing saved runtime deadlines are preserved.
- Catalog version 3 implements narrower requirements and explicit `outOfScope` entries. Each problem has its own middle-probe bank and final incident; source-backed guarantees and defensible alternatives guide assessment rather than mandatory technology names.
- The runtime reserves three substantive slots: a core-flow opening, one relevant technical decision, and the incident last. Clarifications remain within the current slot. Optional revision choices are silent UI checkpoints.
- Candidate-visible duration and question count are supplied by the catalog endpoint, so the practice page can display the configured policy accurately.
- Existing interviews keep the problem snapshot they were created with. Regression coverage checks the new defaults, three-slot progression, alternative diagrams, repeat handling, deadline preservation, and the failure scenario's position. Real candidate completion-time and semantic relevance claims still need measurement.

### Operational measurement contract

`GET /api/v1/metrics` is authenticated and owner-scoped. It returns up to 200 recent recorded rounds, including the total count and selection limit. Numeric stage/usage summaries survive raw-interview cleanup; report deletion and account deletion remove the corresponding retained metrics. The completion denominator includes recorded rounds with an allocated voice session, including unfinished started rounds, not every visitor or every historical interview ever created.

The collected numbers include sample counts and p50/p95 durations for model calls, backend attempts, and voice events; reported token/audio/character usage; model failures, voice errors, retries, repeats, and disconnects; and valid pinned-reference coverage for eligible repository questions. Failed and cancelled samples are reported separately from successful latency samples. Streaming STT usage duration is not interpreted as recognition latency.

The voice response-start measure is a worker engine-speaking proxy, not browser-audible latency. The actual intentional startup wait is recorded separately; only adjusted startup duration subtracts that recorded wait, normally 10 seconds. No normal turn or provider-call duration subtracts ten seconds.

Four optional configured USD rates enable a usage-based cost estimate: `METRICS_LLM_INPUT_USD_PER_MILLION`, `METRICS_LLM_OUTPUT_USD_PER_MILLION`, `METRICS_STT_USD_PER_MINUTE`, and `METRICS_TTS_USD_PER_MILLION_CHARACTERS`. Unknown rates or missing usage keep estimates absent or incomplete. Provider invoices, cached-token discounts, failed-request charging, and model-specific rates can differ.

Reference coverage does not establish semantic question quality. Disconnect and retry counts do not establish a recovery-success rate. This document contains no benchmark results; the controlled backend run and subsequent real voice sessions must establish any reported performance figures with their scope and sample counts.

The project reviewer used for the initial research is `.cursor/agents/system-design-interview-reviewer.md`.
