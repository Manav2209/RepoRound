# Landing, authentication, and interview memory specification

**Status:** Proposed implementation spec, not yet implemented  
**Updated:** 22 October 2026  
**Order:** Minimal landing page → authentication → interview memory and retention

**Memory update:** The interview-memory and retention design in sections 4–5 is superseded by `interview-memory-postgres-falkordb-spec.md`. The newer spec keeps PostgreSQL as the recoverable source, uses FalkorDB only for the existing design graph and an optional fact-retrieval projection, and excludes Mem0 and per-interview Markdown files.

This spec describes the next product phase after the current production bug fixes and local walkthrough. It extends `spec/improvement-spec.md` and `spec/final-interviewer-spec.md`. For authentication, session-scoped agent memory, and data retention, the decisions here replace those specs' anonymous-access and “no persistent agent memory” scope limits. The existing two interview modes, canvas rules, LiveKit voice path, evaluation grounding, and backend-owned interview state machine remain in force. This phase does not require changing Hono to Express.

## 1. Product outcome

A visitor lands on a short public page, signs in, and then practices either a GitHub or System Design interview. During an interview, the agent can recall facts and relationships from earlier answers without treating unverified claims as truth. After evaluation, the user can revisit the final report; raw interview material and the interview memory graph are removed.

The account and final report are durable. Interview memory is scoped to **one interview**. Reports are not silently fed into future interviews, and this phase does not create a cross-interview candidate profile.

## 2. Minimal landing page

Route `/` is public and has one job: explain the product and move the visitor to authentication or practice.

- Header: RepoRound wordmark; **Sign in** for visitors, **Practice** and account menu for signed-in users.
- Hero: one plain headline, one sentence explaining project-based and system-design interview practice, and one primary **Start practicing** button. The button opens sign-up for visitors and `/practice` for signed-in users.
- Below the hero: a compact three-step explanation: choose a mode, speak through decisions, receive grounded feedback. Keep it short enough to scan without scrolling through a long feature list.
- Footer: privacy and terms links, especially a clear link to the raw-data deletion policy. Do not place the GitHub URL input, design-problem selector, transcript, or pricing on this page.

`/practice` becomes the authenticated home for the existing mode tabs, GitHub URL input, and system-design problem selection currently rendered by `apps/web/app/page.tsx` and `StartInterview`. Do not redesign the interview room or canvas as part of the landing work. A signed-out visitor who opens `/practice` or an interview URL is redirected to sign-in with a safe same-origin `returnTo` path. After sign-in, return them there. Auth pages show errors without losing the intended destination.

## 3. Authentication

### Supported methods and screens

- Email **and password** for registration and sign-in. Require email verification before starting practice. Provide password reset using a single-use, short-lived email link. Never email a password.
- Google sign-in using OpenID Connect.
- GitHub sign-in using OAuth. Request only identity and verified-email access; repository access is not needed for sign-in because the interview currently accepts public repositories.
- One sign-in page offers all three methods. Sign-up is a small variant of the same page. An account page shows email, linked providers, and sign-out.

If a provider does not return a verified email, ask the user to add and verify one before the account can practice. Do not silently merge accounts solely because two providers report the same address. A signed-in user may explicitly link another provider after a fresh authentication step. Provider failures, denied consent, expired links, and existing-account conflicts must have recoverable user-facing messages.

### Session and authorization contract

Keep the Hono backend as the owner of identity and API authorization. Browser authentication uses an opaque, revocable server-side session in a `Secure`, `HttpOnly`, `SameSite=Lax` cookie in production. Local HTTP development may omit `Secure`; production may not. Store only a hash of the session secret in PostgreSQL. Rotate the session after sign-in and other privilege changes; revoke it on sign-out. Password hashes use Argon2id with current reviewed parameters, never plaintext or reversible encryption.

All browser requests use the cookie on the same site. Replace the current `localStorage` `interview-access` bearer token and its automatic anonymous bootstrap in `apps/web/lib/api.ts`. The backend must obtain `userId` from the validated session, never from a request body or route parameter. Keep the separate `INTERNAL_API_TOKEN` used by the voice worker; browser login must not grant access to internal routes.

Validate the `Origin` of state-changing cookie-authenticated requests and use CSRF protection where the route can be triggered cross-site. OAuth callbacks require state, nonce where applicable, and PKCE. Bound and allowlist `returnTo` to local paths. Rate-limit registration, login, reset, verification, and OAuth-start endpoints by account identifier and the trusted client IP; do not reveal whether an email exists. Store provider secrets, email-delivery credentials, and password-reset signing material only on the server. Redact tokens, cookies, passwords, and OAuth codes from logs and traces.

The existing anonymous `BrowserUser`/`BrowserAccessSession` model is a migration input, not the final account model. Add durable account, credential, linked-provider, verification/reset-token, and session records via a reviewed Prisma migration. Existing active anonymous interviews should be allowed to finish during rollout; they must not become another user's interviews automatically. A deliberate claim flow may associate an anonymous interview only when the browser proves possession of its old token after signing in. Disable anonymous creation of new practice interviews once the authenticated flow is live.

### Required authorization behavior

Every interview, submission, transcript, and report lookup is scoped to the signed-in account. Missing or other users' resources return the same non-disclosing response. The result page and retry-evaluation action must enforce the same owner check. Sign-out revokes the browser session; a separate account-deletion action removes linked providers, sessions, reports, and any active interview data. The voice worker retains access only to its existing authenticated internal endpoints and interview-specific work.

## 4. Interview memory

### What memory means here

FalkorDB becomes the queryable **working memory for the current interview**, in addition to its existing immutable system-design topology graph. It records short, structured facts and relationships extracted from candidate answers: project details, design decisions, stated tradeoffs, follow-up topics, contradictions, and questions already answered. It is not a general chat history or a replacement for PostgreSQL's runtime leases, deduplication, job intents, or transcript needed for recovery and evaluation.

The current `InterviewRuntime` already holds claims, evidence, objectives, and question history in PostgreSQL; the current FalkorDB graph holds submitted system-design components and edges. The memory work should reuse those validated facts and add a distinct interview-scoped graph projection. Existing `DesignComponent`/`FLOWS_TO` nodes remain immutable and submission-scoped. Memory nodes must never alter the submitted architecture or claim that a candidate changed it.

### Fact model and write path

Use code-defined labels and relationship types, with parameterized Cypher. A memory fact has `interviewId`, stable `factId`, concise summary, kind, topic, source `turnId` and question ID, observed time, confidence, and one of `candidate_claim`, `supported`, `contradicted`, or `uncertain`. Add scoped entity nodes for repository files, services/components, concepts, and objectives when they help traversal. Supported relationship examples are `ABOUT`, `SUPPORTS`, `CONTRADICTS`, and `FOLLOW_UP_TO`. Every graph read and mutation filters by `interviewId`; indexes support that lookup. Do not store account credentials, email addresses, raw audio, full answers, or whole prompts in the graph.

1. Persist each final candidate turn in PostgreSQL first, retaining the existing stable turn ID and retry deduplication.
2. Reuse the validated answer analysis and objective/evidence rules to form candidate facts. A repository-derived fact is distinguishable from something the candidate actually said. A claim stays unverified until the existing verification path supports it; absence from a partial repository index is not a contradiction.
3. Commit the small canonical fact ledger with the existing interview runtime under its lease/version check. Project it idempotently into FalkorDB by `interviewId` and `factId`. Repeated turns, retries, and graph reconnects must not duplicate facts. Rebuild missing graph facts from the temporary PostgreSQL ledger after a graph outage.
4. Before choosing or phrasing the next question, fetch a bounded set of relevant facts for the current objective and entities, preferring recent, sourced, and supported facts. Include status and source in the prompt. The agent may refer to a candidate claim as a claim; it may not upgrade that claim into verified truth or use repository facts as proof of candidate skill.

Bound graph reads so a slow or unavailable FalkorDB does not stall voice. When the graph is unavailable, use the existing PostgreSQL runtime facts and objective state to ask a safe clarification, then repair the projection asynchronously or on the next turn. Memory selection never controls phase changes directly: the backend objective engine still decides the next action. Keep a per-turn cap on graph queries, returned facts, prompt characters, and fact writes. Preserve the existing 60,000-character model input limit and source-quote checks used by evaluation.

### Lifecycle and retention

**During an active or retryable interview**, PostgreSQL must still hold the transcript, runtime, submitted snapshots, job intents, and compact fact ledger. These records are necessary to reconnect, deduplicate turns, recover work, and evaluate actual answers. Moving all of them to FalkorDB would break those guarantees. FalkorDB holds the queryable projection and can be rebuilt from the temporary PostgreSQL source.

**After evaluation completes**, create an account-owned `Report` record independent of the `Interview` row. It contains the final score, dimensions, strengths, weaknesses, feedback, coverage warning, mode, completion time, and only the short evidence excerpts intentionally displayed in the report. Those excerpts are part of the retained report and must be covered by the privacy notice. Do not copy the full transcript, complete submitted diagrams, repository index, or graph memory into the report. The user can view and delete reports from their account. Reports are not used as agent memory in a later interview.

Once the report and its ownership are durably committed, an idempotent cleanup process removes the interview's conversation turns, realtime and domain events, runtime, plan, sessions, jobs, repository knowledge, design snapshots, temporary fact ledger, voice-agent outbox entries, and FalkorDB memory/topology nodes. The current `Evaluation` and `Interview` foreign-key design means this requires a migration: copy the report first, then delete the old interview tree. Keep the cleanup intent in an account-owned table independent of the interview it deletes, so deleting the interview cannot erase unfinished cleanup work. Do not delete source records while evaluation is pending, failed, or eligible for retry. An interrupted cleanup retries safely. If graph deletion fails, retain the cleanup intent and retry until it succeeds; account deletion uses the same mechanism. Add a reconciliation sweep for completed interviews whose cleanup was interrupted.

Give the report the former interview ID as its lookup key, or maintain a durable mapping, so existing `/interview/:id/result` links can resolve an account-owned report after the `Interview` row is deleted. The result page cannot rely on `GET /:interviewId/transcript` once cleanup finishes; show report evidence excerpts instead, and make transcript unavailable after deletion. Make the raw-data deletion boundary visible to users. Do not enable audio recording by default. Observability logs and provider traces must not reintroduce raw answers after cleanup; apply matching retention/redaction there. Existing backups may retain encrypted copies until their documented expiry, so the privacy statement must state that limit rather than promise instantaneous removal from backups.

## 5. Delivery order and acceptance checks

1. **Landing and routing:** public `/`, protected `/practice`, safe redirect after sign-in, existing mode selection moved without changing its behavior.
2. **Identity:** email/password verification and reset, Google and GitHub login, secure server sessions, provider linking, account deletion, and end-to-end ownership checks. Migrate existing anonymous access without orphaning active work.
3. **Memory:** interview-scoped fact ledger and Falkor projection, bounded retrieval in both modes, outage fallback/rebuild, and tests that unsupported claims remain labeled as claims.
4. **Retention:** independent report model, raw-data cleanup, graph cleanup and retry, result-page adaptation, and privacy copy.

The phase is complete when a new user can register by email/password or either OAuth provider; a signed-out visitor cannot create or read practice interviews; all three methods reach the same protected practice flow; a later answer can cause a grounded follow-up using an earlier sourced fact; a graph outage does not lose the interview; and a completed evaluation leaves an accessible report but no raw transcript or interview graph. Verify the full flow locally before any deployment. Include tests for account collisions, CSRF/redirect handling, cross-user access, turn retries, memory scoping, graph recovery, and interrupted cleanup.
