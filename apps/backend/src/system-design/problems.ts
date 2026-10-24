import type {
  ProblemConfig,
  ProblemSummary,
} from "@repo/voice-types";

export const PROBLEM_VERSION = 2;

const UNLISTED_CLARIFICATION =
  "Make a reasonable assumption, state it, and continue.";

export const PROBLEMS: ProblemConfig[] = [
  {
    id: "notification-system",
    version: PROBLEM_VERSION,
    title: "Design a Notification System",
    difficulty: "HARD",
    brief:
      "Design a service that accepts notification requests and delivers email, SMS, and push notifications. Describe the major components and the message flow.",
    visibleRequirements: [
      "Notifications are accepted quickly by a public API.",
      "Delivery is asynchronous from request acceptance.",
      "Requests are routed to the correct channel (email, SMS, push).",
      "The system tolerates temporary provider failures.",
      "Duplicate notifications are handled reasonably.",
    ],
    loadAssumption:
      "About 1 million notification requests per day, with short peaks around 200 requests per second.",
    constraints: [
      "Accept requests quickly; delivery is asynchronous from acceptance.",
      "Providers may fail temporarily, and duplicate requests are possible.",
      "User channel preferences and opt-outs exist. Exactly-once third-party delivery is not guaranteed.",
    ],
    clarificationAnswers: {
      scale:
        "Assume about 1 million notification requests per day, and state your own peak and latency assumptions.",
      reliability:
        "Providers may fail temporarily. Delivery is best-effort; true exactly-once third-party delivery is not guaranteed.",
      preferences:
        "User channel preferences and opt-outs can be assumed to exist.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Separates request acceptance from delivery with an asynchronous buffer.",
      "Routes notifications per channel and provider.",
      "Handles provider failures without losing pending work.",
      "Reasons about duplicate suppression and delivery guarantees.",
      "Explains scaling of workers and queues under load.",
    ],
    challenge: {
      id: "sms-provider-outage",
      prompt:
        "The SMS provider is down for 30 minutes during peak traffic. What happens to accepted SMS requests, and how would your design recover without a burst of duplicates?",
      targetConcepts: ["retry", "backoff", "dead-letter", "idempotency"],
    },
  },
  {
    id: "url-shortener",
    version: PROBLEM_VERSION,
    title: "Design a URL Shortener",
    difficulty: "MEDIUM",
    brief:
      "Design a service that maps long URLs to short links and redirects users quickly.",
    visibleRequirements: [
      "Creating a short link is fast and returns a unique code.",
      "Redirects are low latency and highly available.",
      "The system scales reads far beyond writes.",
    ],
    loadAssumption:
      "About 10 million new links per day and roughly 1 billion redirects per day (100:1 reads to writes).",
    constraints: [
      "Redirects should be low latency and highly available.",
      "Links may optionally expire; assume a reasonable default.",
      "Creation must return a unique code and stay fast.",
    ],
    clarificationAnswers: {
      readWrite:
        "Assume reads dominate writes by roughly 100:1; state your own assumptions.",
      expiry: "Links may optionally expire; assume a reasonable default.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Chooses a key generation strategy and explains collisions.",
      "Separates the write path from the read/redirect path.",
      "Adds caching for hot links.",
      "Reasons about database choice and durability.",
    ],
    challenge: {
      id: "hot-link-spike",
      prompt:
        "One short link suddenly receives a very large share of all traffic. Explain how your design handles the spike.",
      targetConcepts: ["cache", "rate-limiting", "scaling"],
    },
  },
  {
    id: "rate-limiter",
    version: PROBLEM_VERSION,
    title: "Design a Rate Limiter",
    difficulty: "MEDIUM",
    brief:
      "Design a rate limiter that enforces per-client request limits across a fleet of servers.",
    visibleRequirements: [
      "Limits are enforced consistently across servers.",
      "The limiter does not become a single point of failure.",
      "Limiting decisions are fast on the request path.",
    ],
    loadAssumption:
      "Up to about 100,000 requests per second across the fleet, with limits tracked per client API key.",
    constraints: [
      "Any standard algorithm is acceptable if its trade-offs are explained.",
      "Slight over-admission under races is acceptable; state your tolerance.",
      "A limiter-store outage must not block all API traffic.",
    ],
    clarificationAnswers: {
      algorithm:
        "Any standard algorithm is acceptable; state the trade-offs you chose.",
      consistency:
        "Slight over-admission under races is acceptable; state your tolerance.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Uses atomic operations or a shared counter store.",
      "Explains distributed coordination and clock concerns.",
      "Handles the store being unavailable without blocking all traffic.",
    ],
    challenge: {
      id: "store-outage",
      prompt:
        "The shared counter store becomes unavailable. Explain what your limiter does and how you keep the API serving.",
      targetConcepts: ["fail-open", "caching", "degradation"],
    },
  },
  {
    id: "chat-application",
    version: PROBLEM_VERSION,
    title: "Design a Chat Application",
    difficulty: "HARD",
    brief:
      "Design a real-time chat service supporting one-to-one and group conversations.",
    visibleRequirements: [
      "Messages are delivered in near real time.",
      "Message ordering is consistent per conversation.",
      "The system supports presence and offline delivery.",
    ],
    loadAssumption:
      "Millions of concurrent connections, with a typical user active in a handful of conversations.",
    constraints: [
      "Per-conversation ordering is required; global ordering is not.",
      "Messages must be durable enough for offline delivery.",
      "Presence can be approximate and may lag.",
    ],
    clarificationAnswers: {
      scale:
        "Assume millions of concurrent connections; state your assumptions.",
      ordering: "Per-conversation ordering is required; global ordering is not.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Uses persistent connections and a fan-out strategy.",
      "Stores messages durably and preserves per-conversation order.",
      "Handles presence and offline delivery queues.",
    ],
    challenge: {
      id: "connection-server-loss",
      prompt:
        "A connection server holding a large number of clients crashes. Explain what happens to those clients and the messages in flight.",
      targetConcepts: ["reconnect", "durability", "fan-out"],
    },
  },
  {
    id: "file-storage",
    version: PROBLEM_VERSION,
    title: "Design a File Storage Service",
    difficulty: "MEDIUM",
    brief:
      "Design a service where users upload, store, and download files.",
    visibleRequirements: [
      "Large uploads and downloads are efficient.",
      "File metadata is queryable.",
      "Storage scales independently of metadata.",
    ],
    loadAssumption:
      "Files up to multiple gigabytes, with storage growing to millions of objects.",
    constraints: [
      "Large transfers should be efficient and resumable where practical.",
      "Files are private by default and shared through explicit access.",
      "Metadata and object storage must stay consistent enough to detect failed uploads.",
    ],
    clarificationAnswers: {
      size: "Assume files up to multiple gigabytes; state your assumptions.",
      access: "Files are private by default and shared via explicit access.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Separates object storage from metadata storage.",
      "Handles large uploads with chunking or pre-signed URLs.",
      "Reasons about consistency between metadata and stored objects.",
    ],
    challenge: {
      id: "metadata-object-mismatch",
      prompt:
        "A metadata write succeeds but the object upload fails. Explain how your design detects and repairs this.",
      targetConcepts: ["consistency", "reconciliation", "idempotency"],
    },
  },
  {
    id: "job-queue",
    version: PROBLEM_VERSION,
    title: "Design a Job Queue System",
    difficulty: "HARD",
    brief:
      "Design a distributed job queue that schedules work, retries failures, and supports delayed jobs.",
    visibleRequirements: [
      "Jobs are processed at least once with retries.",
      "Failed jobs are moved to a dead-letter path.",
      "Workers can crash without losing jobs.",
    ],
    loadAssumption:
      "About 10,000 jobs per second at peak, with immediate, delayed, and retried work.",
    constraints: [
      "At-least-once delivery is acceptable; duplicate execution must be considered.",
      "Per-key ordering is required only where requested.",
      "A poison job must be isolated without blocking unrelated work.",
    ],
    clarificationAnswers: {
      ordering:
        "Assume per-key ordering where requested, otherwise best-effort.",
      duplicates: "At-least-once delivery is acceptable; state your assumptions.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Uses leases or visibility timeouts for job ownership.",
      "Implements retry with backoff and a dead-letter queue.",
      "Reasons about worker failure and recovery.",
    ],
    challenge: {
      id: "poison-message",
      prompt:
        "One job repeatedly fails and blocks a queue. Explain how your design isolates it and keeps other work flowing.",
      targetConcepts: ["dead-letter", "isolation", "backoff"],
    },
  },
  {
    id: "news-feed",
    version: PROBLEM_VERSION,
    title: "Design a News Feed",
    difficulty: "HARD",
    brief:
      "Design a social news feed that shows recent posts from accounts a user follows.",
    visibleRequirements: [
      "Feed reads are fast for active users.",
      "New posts appear with acceptable freshness.",
      "The system supports both fan-out on write and read trade-offs.",
    ],
    loadAssumption:
      "About 100 million daily active users, with a few accounts having tens of millions of followers.",
    constraints: [
      "A reverse-chronological feed is acceptable; ranking is optional.",
      "Feed reads should stay fast for active users.",
      "High-follower accounts must not create write-amplification storms.",
    ],
    clarificationAnswers: {
      scale:
        "Assume a mix of normal users and a few very high-follower accounts; state your assumptions.",
      ranking: "Reverse-chronological is acceptable; ranking is optional.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Chooses a fan-out strategy and explains its trade-offs.",
      "Uses caching and pagination for feed reads.",
      "Handles high-follower accounts without write amplification storms.",
    ],
    challenge: {
      id: "celebrity-post",
      prompt:
        "An account with tens of millions of followers posts. Explain how your feed design avoids overwhelming the system.",
      targetConcepts: ["fan-out", "hybrid", "caching"],
    },
  },
  {
    id: "ride-hailing",
    version: PROBLEM_VERSION,
    title: "Design a Ride-Hailing System",
    difficulty: "HARD",
    brief:
      "Design a system that matches riders with nearby drivers in real time.",
    visibleRequirements: [
      "Driver locations are tracked with low latency.",
      "Riders are matched to suitable nearby drivers.",
      "The system handles supply and demand imbalance.",
    ],
    loadAssumption:
      "About 100,000 active drivers sending location updates every few seconds during peak.",
    constraints: [
      "Location updates are frequent and can be slightly stale.",
      "Matching quality can be approximate; state an acceptable latency.",
      "A rider must not be assigned two drivers at once.",
    ],
    clarificationAnswers: {
      location:
        "Assume location updates arrive every few seconds; state your assumptions.",
      matching:
        "Matching quality can be approximate; state your acceptable latency.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Uses a geospatial index for nearby search.",
      "Separates location ingestion from matching.",
      "Reasons about consistency during matching races.",
    ],
    challenge: {
      id: "two-drivers-one-rider",
      prompt:
        "Two drivers are matched to the same rider at once. Explain how your design prevents or resolves the conflict.",
      targetConcepts: ["locking", "consistency", "idempotency"],
    },
  },
  {
    id: "video-streaming",
    version: PROBLEM_VERSION,
    title: "Design a Video Streaming Platform",
    difficulty: "HARD",
    brief:
      "Design a platform where users upload videos and viewers stream them.",
    visibleRequirements: [
      "Uploads are stored durably.",
      "Videos are transcoded into multiple renditions.",
      "Playback is fast and reliable globally.",
    ],
    loadAssumption:
      "Multi-gigabyte uploads, global viewers, and a small set of very popular videos.",
    constraints: [
      "Adaptive bitrate playback is expected.",
      "Transcoding is asynchronous and may lag under load.",
      "Uploads must remain durable even when processing fails.",
    ],
    clarificationAnswers: {
      scale: "Assume large files and global viewers; state your assumptions.",
      quality: "Adaptive bitrate playback is expected.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Separates ingestion, transcoding, and delivery.",
      "Uses object storage and a CDN.",
      "Reasons about async processing and status tracking.",
    ],
    challenge: {
      id: "transcode-backlog",
      prompt:
        "Transcoding falls far behind uploads during a spike. Explain how your design keeps the platform healthy.",
      targetConcepts: ["backpressure", "prioritization", "scaling"],
    },
  },
  {
    id: "ticket-booking",
    version: PROBLEM_VERSION,
    title: "Design a Ticket Booking System",
    difficulty: "HARD",
    brief:
      "Design a system that lets users reserve seats for a popular event without overselling.",
    visibleRequirements: [
      "Seats are never double-booked.",
      "Reservations are held temporarily before payment.",
      "The system stays responsive under contention.",
    ],
    loadAssumption:
      "Tens of thousands of users competing for a few thousand seats when a popular event opens.",
    constraints: [
      "Seats must never be double-booked.",
      "Temporary holds expire after a reasonable duration.",
      "The system must protect inventory and remain responsive during a flash sale.",
    ],
    clarificationAnswers: {
      contention:
        "Assume a small number of very popular events; state your assumptions.",
      holds: "Temporary holds may expire; assume a reasonable hold duration.",
      unlisted: UNLISTED_CLARIFICATION,
    },
    evaluationGoals: [
      "Prevents overselling with transactional or atomic reservation.",
      "Uses time-bound holds with expiry.",
      "Reasons about contention and fairness under load.",
    ],
    challenge: {
      id: "flash-sale",
      prompt:
        "Tickets for a popular event go on sale and traffic spikes instantly. Explain how your design protects inventory and stays responsive.",
      targetConcepts: ["locking", "queueing", "hold-expiry"],
    },
  },
];

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
    }) => ({
      id,
      version,
      title,
      difficulty,
      brief,
      visibleRequirements,
      loadAssumption,
      constraints,
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
  };
}
