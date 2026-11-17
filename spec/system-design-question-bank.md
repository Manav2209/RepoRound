# System Design question bank

**Status** Proposed for review

This bank covers the ten problems in the [current catalog](../apps/backend/src/system-design/problems.ts). Each problem has three optional discussion probes, a standard final incident question, and a version of that question tied to something the candidate said. The evidence column is for assessment.

## Selection and pacing

- Start with a request walkthrough from the candidate's active diagram. Use the existing substantive question targets of four with at least 11 minutes left at the start, three with at least seven, and two otherwise.
- A discussion slot is available only after accounting for the opening and the final incident. Choose a probe when its trigger matches a visible component or directed path in the active revision, or a relevant claim made or reconfirmed for that revision. When several match, pick an uncovered guarantee first, then an important flow or tradeoff. Skip a probe if the candidate already explained its mechanism or the same probe was asked earlier. If no problem-specific probe applies, use the existing diagram-grounded fallback.
- Spend the existing optional clarification on an unanswered question or a consequential inconsistency when more than four minutes remain. The clarification asks about the same mechanism. With under three minutes left, move to the fixed final incident at the next eligible checkpoint.
- Use the claim-based final prompt only when the candidate made the referenced claim and it still applies to the active revision. Use the standard prompt otherwise. Both variants preserve the catalog incident. Assess the impact or recovery mechanism the question asks about, and credit a detection signal when the candidate explains one.
- Each spoken prompt has one question, at most 35 words, and at most 320 characters. Use the same limits in the generation prompt and the runtime check. A declarative setup can name the scenario or recap a candidate claim. Prefer a checked template when model output changes the premise, adds a second question, or exceeds the limits.
- Reuse the active snapshot, answer assessments, and recorded claims. The bank adds no model call or external lookup. The initial brief shows the stated scale, the required guarantees and the choices a candidate can make. The final incident is delivered during the interview.

The scale figures below come from the existing catalog. Where a target has no number, the candidate can state a reasonable target and explain how it affects the design.

## Notification System

**Scale.** About one million requests/day, with short peaks around 200 requests/sec.

**Required.** Accept quickly and deliver asynchronously across email, SMS, and push. Respect channel preferences and opt-outs. Handle temporary provider failures and duplicates. Third-party delivery has no exactly-once guarantee.

**Candidate choices.** Acceptance latency, retry window, and the point at which a preference change takes effect.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `acceptance` | The diagram or answer shows an asynchronous delivery handoff | What has to happen before your API can safely acknowledge a notification request? | A concrete acceptance boundary and what survives a restart |
| `opt-out` | Candidate says preferences are checked before delivery | If a user opts out after their notification is accepted, when does your design check that preference? | When opt-outs take effect and how pending work sees the change |
| `duplicate-request` | Candidate says repeated requests are deduplicated | When the same notification request arrives twice, how does your design tell a retry from a new notification? | The identity, lifetime, and scope of the duplicate check |

Use the claim-based final when the candidate says accepted notifications stay pending until delivery.

- **Standard.** The SMS provider goes down for 30 minutes during peak traffic. How does your design recover accepted SMS messages without a burst of duplicates?
- **Claim-based.** You said accepted messages stay pending. The SMS provider goes down for 30 minutes during peak traffic. How does your design recover those messages without a burst of duplicates?

## URL Shortener

**Scale.** About 10 million links created and one billion redirects/day, roughly 100 reads per write.

**Required.** Create unique short codes quickly. Serve redirects with low latency and high availability.

**Candidate choices.** Code generation, redirect latency target, and whether links expire.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `redirect-miss` | The diagram or answer shows a cache on the redirect path | If a code is missing from your redirect cache, how does your system find the destination? | Lookup path, source of truth, and cache fill behavior |
| `code-collision` | Candidate describes a code-generation mechanism | How does your create path handle two requests producing the same short code at the same time? | Who enforces uniqueness and what happens to the losing write |
| `expiry` | Candidate supports expiry and caches redirects | How does your redirect path stop serving a cached link when it expires? | Expiry semantics and how stale entries are handled |

Use the claim-based final when the candidate says caching keeps redirects fast.

- **Standard.** One short link suddenly receives a very large share of all traffic. How does your redirect path handle that spike?
- **Claim-based.** You said caching keeps redirects fast. One short link suddenly receives a very large share of all traffic. How does your redirect path absorb that spike?

## Rate Limiter

**Scale.** Up to 100,000 requests/sec across the fleet, limited per API key.

**Required.** Make fast admission decisions across servers. Keep the API serving during a limiter-store outage. Slight over-admission under races is acceptable within a stated tolerance.

**Candidate choices.** Algorithm, over-admission tolerance, and latency budget.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `concurrent-admission` | The diagram or answer shows multiple servers deciding for the same API key | When two servers check the same API key at once, how does your design limit excess admissions? | State ownership, coordination, and the stated race tolerance |
| `window-boundary` | Candidate chooses an algorithm with fixed window boundaries | What does your limiter allow if one API key sends a burst on each side of a window boundary? | Whether the candidate can explain the chosen algorithm's burst behavior |
| `latency-budget` | Candidate puts the limiter on every request's critical path | What latency budget would you give the limiter on each request? | A concrete budget and a check that the proposed decision path can plausibly fit it |

Use the claim-based final when the candidate says admission reads or updates shared counters.

- **Standard.** The shared counter store becomes unavailable. How does your limiter keep the API serving?
- **Claim-based.** You said admission depends on a shared counter. The shared counter store becomes unavailable. How does your limiter keep the API serving?

## Chat Application

**Scale.** Millions of concurrent connections, with a typical user active in a handful of conversations.

**Required.** Support near-real-time direct and group chat, offline delivery, and ordering within each conversation. Presence can lag.

**Candidate choices.** Delivery latency, presence freshness, and how to fan out group messages.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `group-delivery` | The diagram or answer shows group members connected across servers | How does one new group message reach members connected to different servers in your design? | Recipient discovery and delivery to the right connections |
| `message-order` | Candidate claims the design orders messages within a conversation | If two people send messages to the same conversation at the same time, where does your design decide which message comes first? | A specific ordering authority and the scope of the order |
| `reconnect` | Candidate describes offline delivery or reconnect catch-up | When a client reconnects, how does your system know which messages that client still needs? | A resume position, gap handling, and duplicate behavior |

Use the claim-based final when the candidate says reconnecting clients catch up from durable storage.

- **Standard.** A connection server holding many clients crashes. How does your design restore those clients' connections and handle the messages in flight?
- **Claim-based.** You said clients catch up from durable storage. A connection server holding many clients crashes. How do those clients reconnect and recover messages that were in flight?

## File Storage Service

**Scale.** Multi-gigabyte files and millions of objects.

**Required.** Keep files private by default and share through explicit access. Detect failed uploads when metadata and stored objects disagree. Make large transfers efficient and resumable where practical.

**Candidate choices.** When an upload becomes visible, how resumable transfers work, and how quickly to detect orphaned state.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `upload-ready` | Upload flow shows both metadata and storage, or candidate describes a ready state | At what point does your design let a user find and download a file they just uploaded? | The completion signal and the transition into a visible state |
| `transfer-resume` | Candidate describes resumable or multipart uploads | If a large upload disconnects halfway through, how does your design determine which bytes the client still needs to send? | A persistent upload identity and source of committed progress |
| `private-download` | Candidate describes a sharing or access flow for private files | What does your download path check before it serves a private file to a user who didn't upload it? | Access authority and how the read path enforces it |

Use the claim-based final when the candidate described a completion check before visibility.

- **Standard.** A metadata write succeeds, but the object upload fails. How does your design detect and repair that incomplete upload?
- **Claim-based.** You said files become available after a completion check. A metadata write succeeds, but the object upload fails. How does your design detect and repair that incomplete upload?

## Job Queue System

**Scale.** About 10,000 jobs/sec at peak across immediate, delayed, and retried work.

**Required.** Process jobs at least once, recover after a worker crash, and isolate poison jobs in a dead-letter path. Consider duplicate execution. Provide per-key ordering where requested.

**Candidate choices.** Retry limit and timing, delay precision, and mechanisms for ownership and duplicate effects.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `delayed-job` | The diagram or answer describes delayed scheduling | How does a delayed job become available to a worker when its scheduled time arrives? | Who owns scheduling and the transition into claimable work |
| `repeat-execution` | Candidate acknowledges work after processing | If a worker completes the work and crashes before acknowledgment, what happens when another worker receives that job? | Distinguishes message delivery from application side effects |
| `key-order` | Candidate provides ordering for some keys | If a job for one ordered key is waiting for a retry, what happens to later jobs for that key? | Scope of ordering and the retry-versus-progress tradeoff |

Use the claim-based final when the candidate describes retrying failed jobs.

- **Standard.** One job repeatedly fails and blocks a queue. How does your design isolate it while keeping unrelated work flowing?
- **Claim-based.** You said failed jobs retry. One job repeatedly fails and blocks a queue. How does your retry path isolate that job while keeping unrelated work flowing?

## News Feed

**Scale.** About 100 million daily active users. Some accounts have tens of millions of followers.

**Required.** Keep active users' feed reads fast, make new posts visible within a reasonable freshness window, and bound the write amplification from high-follower accounts.

**Candidate choices.** Fan-out strategy, freshness target, and whether to use ranking or reverse chronology.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `post-visibility` | The diagram or answer shows both post creation and feed reads | What has to happen between publishing a post and a follower seeing it on their next feed read? | Where feed membership is computed and where lag can occur |
| `stable-pagination` | Candidate claims pagination stays stable while posts arrive | If a new post arrives while someone is paging through their feed, how does your design avoid showing a post twice? | Ordering key and what a continuation cursor or equivalent represents |
| `cache-miss` | Candidate caches feed results for active users | When an active user's feed is missing from the cache, what work must your design do before returning it? | Synchronous dependencies, miss cost, and the expected tail latency |

Use the claim-based final when the candidate says some feeds are computed ahead of reads.

- **Standard.** An account with tens of millions of followers posts. How does your feed design avoid overwhelming the system?
- **Claim-based.** You said you compute feeds ahead of reads. An account with tens of millions of followers posts. How does that path avoid overwhelming the system?

## Ride-Hailing System

**Scale.** About 100,000 active drivers reporting locations every few seconds at peak.

**Required.** Track nearby drivers and match riders in real time. A rider can have at most one confirmed driver at a time.

**Candidate choices.** Matching latency, tolerance for stale location data, and approximate search quality.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `location-freshness` | The diagram or answer shows how matching uses reported driver locations | When your matcher looks up nearby drivers, how does it decide whether a driver's last reported location is still useful? | A freshness policy and its effect on eligibility |
| `search-budget` | Candidate says the matcher can widen its search or try another driver | When no nearby driver accepts, how does your matcher decide whether to keep searching or stop? | A stopping rule that fits the stated latency target |
| `offer-confirmation` | Candidate describes drivers accepting offers | When a driver accepts an offer, where does your design decide that the match is confirmed? | An authoritative transition from offer to confirmed assignment |

Use the claim-based final when the candidate described a match-confirmation step.

- **Standard.** Two drivers are matched to the same rider at once. How does your design prevent or resolve the conflicting assignments?
- **Claim-based.** You described a match-confirmation step. Two drivers are matched to the same rider at once. How does that step prevent or resolve the conflicting assignments?

## Video Streaming Platform

**Scale.** Multi-gigabyte uploads, a global audience, and a small set of very popular videos.

**Required.** Store original uploads durably even when processing fails. Transcode asynchronously into multiple renditions and support adaptive bitrate playback.

**Candidate choices.** When a video first becomes playable, acceptable processing lag, and playback startup target.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `upload-durability` | The diagram or answer shows a handoff from uploads to processing | When your platform says an upload is complete, what does your design guarantee about the original video? | Where the original is durably accepted, independent of transcode results |
| `partial-renditions` | Candidate publishes playback information for multiple renditions | If one rendition finishes before the others, how does your design decide what the player can see? | The publication rule and the source of playable rendition state |
| `segment-miss` | The diagram or answer shows cached playback delivery | When a video segment is missing from the cache near the viewer, how does the request reach the segment? | The miss path, origin load, and startup implications |

Use the claim-based final when the candidate says upload acceptance is independent of transcoding.

- **Standard.** Transcoding falls far behind uploads during a spike. How does your design keep the platform healthy while that backlog grows?
- **Claim-based.** You said uploads can finish before transcoding. During an upload spike, transcoding falls far behind. How does your design keep new uploads and playback healthy?

## Ticket Booking System

**Scale.** Tens of thousands of users competing for a few thousand seats during an onsale.

**Required.** Each seat can have at most one confirmed booking. Holds expire. Inventory stays correct while the service responds during a flash sale.

**Candidate choices.** Hold duration, response latency target, and how to handle excess demand fairly.

| Probe | Trigger | Spoken question | Evidence to listen for |
| --- | --- | --- | --- |
| `competing-holds` | The diagram or answer identifies where holds are created | If two customers try to hold the same seat at the same time, which part of your design decides who gets it? | Where the contention is resolved and what the losing request sees |
| `payment-expiry` | Candidate describes timed holds and payment confirmation | If a payment confirmation arrives just as its hold expires, how does your design decide whether the booking succeeds? | A consistent outcome for the race, including a late payment |
| `stale-seat-map` | Candidate separates availability display from the reservation path | If the seat map shows an available seat that was just taken, what happens when a customer tries to hold it? | Which path checks authoritative inventory and what the client receives |

Use the claim-based final when the candidate identified the reservation decision point.

- **Standard.** Tickets for a popular event go on sale and traffic spikes instantly. How does your design protect inventory while staying responsive?
- **Claim-based.** You described where reservations are decided. A popular event goes on sale and traffic spikes instantly. How does that path protect inventory while keeping reservation requests responsive?

## Implementation checks

- Give each probe a stable identifier formed from the existing problem ID and the probe name. Scope selection and evidence to the active revision. Keep the asked probe IDs and the final incident ID across reconnects and revisions.
- Version candidate-visible brief edits alongside the question bank. Preserve the prompt and incident stored with each existing interview so it can finish against the version the candidate saw.
- Test a matching trigger, an absent trigger, a material diagram revision, a claim that was superseded, and a previously answered mechanism. Test that both final wordings preserve the catalog incident and that no routine probe follows it.
- Test representative diagrams and answers for each problem. A candidate using a different mechanism should have a path to demonstrate the same guarantee without being graded on technology names.
