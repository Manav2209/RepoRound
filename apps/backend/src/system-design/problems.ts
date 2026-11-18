import type { ProblemConfig, ProblemSummary } from "@repo/voice-types";
import { QUESTION_BANKS } from "./question-bank.js";

export const PROBLEM_VERSION = 3;

const CATALOG: ProblemConfig[] = [
  {
    id: "notification-system",
    version: PROBLEM_VERSION,
    title: "Design a Notification System",
    difficulty: "HARD",
    brief:
      "Design a service that accepts notification requests and delivers email or SMS asynchronously. Focus on durable acceptance, duplicate requests, and temporary provider failures.",
    visibleRequirements: [
      "Accept a recipient, message, and channel without waiting for provider delivery.",
      "Preserve accepted work through a temporary provider interruption.",
      "Distinguish client retries from new notification requests.",
    ],
    loadAssumption:
      "About 1 million notification requests per day, with short peaks around 200 requests per second.",
    constraints: [
      "Email and SMS delivery providers are supplied building blocks.",
      "Assume preference lookup already exists; preferences and identity do not need to be designed.",
      "Explain delivery and duplicate-effect guarantees without promising exactly-once third-party delivery.",
    ],
    clarificationAnswers: {
      scale:
        "Assume 1 million requests per day and peaks near 200 requests per second; detailed capacity arithmetic is not required.",
      reliability:
        "Accepted work must survive a temporary provider outage. State the limits of duplicate suppression and third-party delivery guarantees.",
      preferences:
        "Assume an existing service supplies channel preferences and opt-outs; its implementation is out of scope.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains the durable acceptance boundary and asynchronous delivery flow.",
      "Explains retry identity and the limits of duplicate suppression.",
      "Explains bounded recovery of accepted work after provider interruption.",
    ],
    challenge: {
      id: "sms-provider-outage",
      prompt:
        "The SMS provider is unavailable for 30 minutes. How does your design recover accepted SMS work without overwhelming the provider when it returns?",
      targetConcepts: ["retry", "backoff", "dead-letter", "idempotency"],
    },
    outOfScope: [
      "Push-specific infrastructure",
      "Preference management and campaigns",
      "Scheduling and quiet hours",
      "Delivery analytics",
      "A separate worker-scaling deep dive",
    ],
  },
  {
    id: "url-shortener",
    version: PROBLEM_VERSION,
    title: "Design a URL Shortener",
    difficulty: "MEDIUM",
    brief:
      "Design a service that creates immutable short links and redirects correctly under read-heavy traffic. Focus on mapping ownership, concurrent code generation, and a hot link.",
    visibleRequirements: [
      "Create a short code that identifies one immutable URL mapping.",
      "Resolve a short code to the correct destination with low redirect latency.",
      "Keep a hot link from overwhelming the authoritative mapping store.",
    ],
    loadAssumption:
      "About 10 million new links per day and roughly 1 billion redirects per day (100:1 reads to writes).",
    constraints: [
      "A successfully created code must not overwrite an existing mapping.",
      "Use the supplied read/write assumptions; detailed capacity arithmetic is not required.",
      "Choose any defensible storage and lookup mechanism; no particular product is required.",
    ],
    clarificationAnswers: {
      readWrite:
        "Assume roughly 100 redirects per new link; state a reasonable redirect latency target.",
      expiry:
        "Expiry and custom aliases are outside this round; mappings remain immutable.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains where authoritative mappings are created and resolved.",
      "Explains collision handling under concurrent creation without overwriting links.",
      "Explains how the hot-link read path protects the mapping store.",
    ],
    challenge: {
      id: "hot-link-spike",
      prompt:
        "One short link receives most redirect traffic. How does your design absorb that load without overwhelming the mapping store?",
      targetConcepts: ["cache", "rate-limiting", "scaling"],
    },
    outOfScope: [
      "Custom aliases and link expiry",
      "Analytics and abuse detection",
      "Multi-region writes",
      "Detailed storage sizing",
    ],
  },
  {
    id: "rate-limiter",
    version: PROBLEM_VERSION,
    title: "Design a Rate Limiter",
    difficulty: "MEDIUM",
    brief:
      "Design a distributed limiter for one API-key quota. Focus on fast admission decisions, bounded concurrent over-admission, and a justified degraded-mode policy.",
    visibleRequirements: [
      "Admit or reject requests for one quota keyed by API key.",
      "Coordinate decisions across servers within a stated small race tolerance.",
      "Define an explicit policy when shared limiter state is unavailable.",
    ],
    loadAssumption:
      "Up to about 100,000 requests per second across the fleet, with limits tracked per client API key.",
    constraints: [
      "Any defensible limiting algorithm is acceptable; explain its tradeoffs.",
      "Small over-admission is acceptable within the tolerance you state.",
      "Balance API availability against overload protection rather than assuming unconditional fail-open.",
    ],
    clarificationAnswers: {
      algorithm:
        "Choose one defensible algorithm and explain its admission behavior; comparing every algorithm is out of scope.",
      consistency:
        "State a small acceptable over-admission tolerance and explain how concurrent checks stay within it.",
      outage:
        "Choose and justify a degraded-mode policy that balances continued service with overload protection.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains the state and decision mechanism of one limiting algorithm.",
      "Explains concurrent admissions within the stated tolerance.",
      "Justifies bounded behavior when shared limiter state becomes unavailable.",
    ],
    challenge: {
      id: "store-outage",
      prompt:
        "The limiter's shared state becomes unavailable. What policy does your design apply to balance continued API availability against overload protection?",
      targetConcepts: ["fail-open", "caching", "degradation"],
    },
    outOfScope: [
      "Multiple quota tiers",
      "Rule-distribution control planes",
      "Multi-region coordination",
      "Every algorithm comparison",
      "Implementation pseudocode",
    ],
  },
  {
    id: "chat-application",
    version: PROBLEM_VERSION,
    title: "Design a Chat Application",
    difficulty: "HARD",
    brief:
      "Design single-region one-to-one text messaging with near-real-time online delivery, durable offline retrieval, and ordering within each conversation.",
    visibleRequirements: [
      "Deliver one-to-one text messages promptly when both users are online.",
      "Retain messages for recipients who are offline.",
      "Preserve a consistent order within each conversation.",
    ],
    loadAssumption:
      "Millions of concurrent connections, with a typical user active in a handful of conversations.",
    constraints: [
      "Global ordering is not required.",
      "Define what a sender confirmation guarantees before the recipient is online.",
      "Equivalent connection, storage, and ordering mechanisms are acceptable.",
    ],
    clarificationAnswers: {
      scale:
        "Use the supplied connection-scale assumption for one region; detailed fleet sizing is not required.",
      ordering:
        "Ordering is required within one conversation, not across all conversations.",
      presence:
        "Presence, group chat, and read receipts are outside this round.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains online delivery and durable offline retrieval.",
      "Explains a per-conversation ordering authority or equivalent mechanism.",
      "Explains reconnection and recovery of messages after connection-server loss.",
    ],
    challenge: {
      id: "connection-server-loss",
      prompt:
        "A connection server crashes with messages in flight. How do affected clients reconnect and recover missing messages without displaying duplicates?",
      targetConcepts: ["reconnect", "durability", "fan-out"],
    },
    outOfScope: [
      "Group fan-out and presence",
      "Media and read receipts",
      "Encryption architecture",
      "Multi-device synchronization",
      "Cross-region routing",
    ],
  },
  {
    id: "file-storage",
    version: PROBLEM_VERSION,
    title: "Design a File Storage Service",
    difficulty: "MEDIUM",
    brief:
      "Design large private file upload and owner-authorized download. Support interrupted-upload resumption and expose only completed uploads.",
    visibleRequirements: [
      "Upload large private files and let their owners download them.",
      "Resume an interrupted transfer without restarting completed work.",
      "Keep incomplete uploads from appearing as downloadable files.",
    ],
    loadAssumption:
      "Files up to multiple gigabytes, with storage growing to millions of objects.",
    constraints: [
      "Owner-only authorization is sufficient; rich sharing permissions are out of scope.",
      "Treat blob storage as a supplied building block.",
      "Define how metadata and stored bytes reach a completed, visible state.",
    ],
    clarificationAnswers: {
      size: "Assume multi-gigabyte files and millions of stored objects; detailed storage sizing is not required.",
      access:
        "Only the owner needs access in this round; assume identity is already available.",
      sharing:
        "Rich sharing permissions, synchronization, and folder models are outside this round.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains the byte-transfer path separately from metadata and authorization.",
      "Explains how persistent upload progress allows safe resumption.",
      "Explains completion visibility and cleanup of incomplete uploads.",
    ],
    challenge: {
      id: "metadata-object-mismatch",
      prompt:
        "Metadata exists but the upload never completes. How does your design prevent a broken download and eventually clean up the incomplete upload?",
      targetConcepts: ["consistency", "reconciliation", "idempotency"],
    },
    outOfScope: [
      "Folder models and rich sharing permissions",
      "Cross-device synchronization and collaboration",
      "Content deduplication",
      "Blob-store internals",
    ],
  },
  {
    id: "job-queue",
    version: PROBLEM_VERSION,
    title: "Design a Job Queue System",
    difficulty: "HARD",
    brief:
      "Design a background job queue with durable acceptance, at-least-once execution, bounded retries, and isolation of permanently failing work.",
    visibleRequirements: [
      "Accept jobs durably and let workers claim them for execution.",
      "Recover unfinished work after worker loss with at-least-once execution.",
      "Bound retries and isolate work that repeatedly fails.",
    ],
    loadAssumption:
      "About 10,000 immediately eligible jobs per second at peak, including retried work.",
    constraints: [
      "Duplicate execution is possible; explain how unwanted repeated effects are controlled.",
      "Immediate jobs are sufficient; cron, delayed scheduling, and per-key ordering are out of scope.",
      "A poison job must not prevent unrelated work from progressing.",
    ],
    clarificationAnswers: {
      ordering: "No per-key ordering is required in this round.",
      duplicates:
        "At-least-once execution is acceptable; explain how application side effects tolerate redelivery.",
      scheduling:
        "Immediate jobs are sufficient; recurring schedules, delayed execution precision, and priorities are out of scope.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains durable acceptance and worker ownership of claimed work.",
      "Distinguishes delivery from application side effects after redelivery.",
      "Explains bounded retries and isolation of permanently failing jobs.",
    ],
    challenge: {
      id: "poison-message",
      prompt:
        "One job keeps failing. How does your design stop its retries from delaying unrelated jobs?",
      targetConcepts: ["dead-letter", "isolation", "backoff"],
    },
    outOfScope: [
      "Cron and delayed execution precision",
      "Job dependencies and priorities",
      "Per-key ordering",
      "Tenant fairness",
    ],
  },
  {
    id: "news-feed",
    version: PROBLEM_VERSION,
    title: "Design a News Feed",
    difficulty: "HARD",
    brief:
      "Design text-post publication and a reverse-chronological feed from followed accounts. Choose a feed-assembly strategy and explain how it handles a high-follower author.",
    visibleRequirements: [
      "Publish text posts for existing users and follow relationships.",
      "Return recent posts from followed accounts in reverse chronological order.",
      "Keep feed reads responsive while permitting a stated short publication lag.",
    ],
    loadAssumption:
      "About 100 million daily active users, with a few accounts having tens of millions of followers.",
    constraints: [
      "Choose a fan-out strategy; implementing both read-time and write-time fan-out is not required.",
      "Assume identity and follow relationships already exist.",
      "Include a high-follower outlier and state an acceptable freshness bound.",
    ],
    clarificationAnswers: {
      scale:
        "Use the supplied user-scale assumption and include one very high-follower author; detailed capacity arithmetic is not required.",
      ranking:
        "Use reverse chronology; ranking and recommendations are out of scope.",
      freshness:
        "A short publication lag is acceptable; state a bound and explain what controls it.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains post publication and feed assembly under the chosen strategy.",
      "Explains the publishing-versus-reading work and freshness tradeoff.",
      "Explains how a high-follower publication avoids overwhelming feed requests.",
    ],
    challenge: {
      id: "celebrity-post",
      prompt:
        "An account with ten million followers posts. How would your design keep feed requests responsive while handling that publication?",
      targetConcepts: ["fan-out", "hybrid", "caching"],
    },
    outOfScope: [
      "Ranking and recommendation models",
      "Media processing, reactions, and comments",
      "Detailed authorization",
      "Advanced pagination guarantees unless already introduced",
    ],
  },
  {
    id: "ride-hailing",
    version: PROBLEM_VERSION,
    title: "Design a Ride-Hailing System",
    difficulty: "HARD",
    brief:
      "Design ride matching in one city. Drivers publish locations, riders request nearby available drivers, and a driver accepts or declines an offer.",
    visibleRequirements: [
      "Use periodically reported driver locations to find nearby available drivers.",
      "Offer a requested ride and confirm an accepted match.",
      "Allow at most one active confirmed assignment per rider and per driver.",
    ],
    loadAssumption:
      "About 100,000 active drivers sending location updates every few seconds during peak.",
    constraints: [
      "Location reports arrive every few seconds and can be slightly stale.",
      "Approximate nearby search is acceptable; state an acceptable matching delay.",
      "Choose any defensible search and coordination mechanism; no particular geospatial product is required.",
    ],
    clarificationAnswers: {
      location:
        "Assume updates every few seconds in one city; explain how much staleness your lookup tolerates.",
      matching:
        "Approximate nearby matching is sufficient; optimal fleet-wide matching is out of scope.",
      assignment:
        "At most one active confirmed assignment is allowed per rider and per driver.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains the request, offer, and confirmed-assignment lifecycle.",
      "Explains efficient nearby lookup under slightly stale location reports.",
      "Explains the authoritative decision that prevents conflicting active assignments.",
    ],
    challenge: {
      id: "two-drivers-one-rider",
      prompt:
        "Two drivers accept offers for the same rider almost simultaneously. Where does your design decide which assignment succeeds?",
      targetConcepts: ["locking", "consistency", "idempotency"],
    },
    outOfScope: [
      "Pricing and payments",
      "Route optimization and ratings",
      "Scheduled rides",
      "Optimal fleet-wide matching",
    ],
  },
  {
    id: "video-streaming",
    version: PROBLEM_VERSION,
    title: "Design a Video Streaming Platform",
    difficulty: "HARD",
    brief:
      "Design video upload, asynchronous processing, and playback of a usable output. Preserve original uploads and expose processing status.",
    visibleRequirements: [
      "Accept and preserve the original uploaded video durably.",
      "Process uploads asynchronously and expose processing status.",
      "Publish a usable output for playback only when it is ready.",
    ],
    loadAssumption:
      "Multi-gigabyte uploads and a mix of ordinary and popular videos; detailed global delivery infrastructure is outside this round.",
    constraints: [
      "Storage, encoding, and delivery services can be supplied building blocks.",
      "The original upload must remain durable if processing is delayed or fails.",
      "Detailed codecs, adaptive-bitrate manifests, and global CDN topology are not required.",
    ],
    clarificationAnswers: {
      scale:
        "Assume large uploads and a mix of ordinary and popular videos; detailed capacity arithmetic is not required.",
      quality:
        "One usable playback output is sufficient; multiple renditions and adaptive-bitrate details are optional depth.",
      processing:
        "Uploads and playback should remain usable while new processing work accumulates.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains the separation between durable upload, asynchronous processing, and playback.",
      "Explains the authoritative transition to a playable output.",
      "Explains backlog control without losing originals or disrupting existing playback.",
    ],
    challenge: {
      id: "transcode-backlog",
      prompt:
        "Uploads arrive faster than videos can be processed. How does your design control the backlog without disrupting existing playback?",
      targetConcepts: ["backpressure", "prioritization", "scaling"],
    },
    outOfScope: [
      "Codec internals and adaptive-bitrate manifest details",
      "Live video, recommendations, search, and moderation",
      "Detailed CDN topology",
      "Resumable-upload protocols",
    ],
  },
  {
    id: "ticket-booking",
    version: PROBLEM_VERSION,
    title: "Design a Ticket Booking System",
    difficulty: "HARD",
    brief:
      "Design booking for one known event with a fixed seat inventory, expiring holds, and confirmation using an external payment result. Never confirm a seat twice.",
    visibleRequirements: [
      "Create a temporary hold for a selected seat in one event.",
      "Confirm a booking using an external payment result before the hold expires.",
      "Never confirm the same seat for more than one booking.",
    ],
    loadAssumption:
      "Tens of thousands of users competing for a few thousand seats when a popular event opens.",
    constraints: [
      "Choose and state a reasonable hold duration.",
      "Treat payment as an external result; payment-provider internals are out of scope.",
      "Protect authoritative inventory and keep reservation requests responsive during contention.",
    ],
    clarificationAnswers: {
      contention:
        "Assume one popular event with the supplied burst and inventory sizes; detailed traffic sizing is not required.",
      holds:
        "Choose a reasonable expiration time and explain how a hold becomes confirmed or expires.",
      payment:
        "Assume a payment provider supplies a confirmation result; refunds and provider internals are out of scope.",
      unlisted: "Make a reasonable assumption, state it, and continue.",
    },
    evaluationGoals: [
      "Explains the hold, confirmation, and expiry lifecycle.",
      "Explains authoritative concurrency control that prevents overselling.",
      "Explains protection of reservation throughput and inventory during a flash sale.",
    ],
    challenge: {
      id: "flash-sale",
      prompt:
        "A popular event opens and traffic spikes immediately. How does your design protect inventory while keeping reservation requests responsive?",
      targetConcepts: ["locking", "queueing", "hold-expiry"],
    },
    outOfScope: [
      "Event discovery and search",
      "Dynamic pricing and refunds",
      "Multi-seat atomicity",
      "Sophisticated waiting-room fairness",
      "Detailed payment compensation",
    ],
  },
];

export const PROBLEMS: ProblemConfig[] = CATALOG.map((problem) => ({
  ...problem,
  questionBank: QUESTION_BANKS[problem.id],
}));

const byId = new Map(PROBLEMS.map((p) => [p.id, p]));

export function getProblem(id: string): ProblemConfig | undefined {
  return byId.get(id);
}

export function problemSummaries(): ProblemSummary[] {
  return PROBLEMS.map(
    ({
      id,
      version,
      title,
      difficulty,
      brief,
      visibleRequirements,
      loadAssumption,
      constraints,
      outOfScope,
    }) => ({
      id,
      version,
      title,
      difficulty,
      brief,
      visibleRequirements,
      loadAssumption,
      constraints,
      outOfScope,
    }),
  );
}

export function problemSummary(id: string): ProblemSummary | null {
  const problem = byId.get(id);
  if (!problem) return null;
  const {
    version,
    title,
    difficulty,
    brief,
    visibleRequirements,
    loadAssumption,
    constraints,
    outOfScope,
  } = problem;
  return {
    id,
    version,
    title,
    difficulty,
    brief,
    visibleRequirements,
    loadAssumption,
    constraints,
    outOfScope,
  };
}
