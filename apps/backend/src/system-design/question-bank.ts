import type { SystemDesignQuestionBank } from "@repo/voice-types";

/** Versioned with each ProblemConfig and copied into the interview snapshot. */
export const QUESTION_BANKS: Record<string, SystemDesignQuestionBank> = {
  "notification-system": {
    opening:
      "Using your diagram, trace a notification from API acceptance to provider delivery, including the point at which acceptance becomes durable.",
    middle: [
      {
        id: "notification-system.duplicate-request",
        prompt:
          "A client retries after a timeout. How does your design distinguish a retry from a new notification without sending the same notification twice?",
        concern: "STATE",
        componentKinds: ["api_service", "database"],
        coverageTerms: ["idempotency", "request", "deduplication"],
      },
      {
        id: "notification-system.acceptance",
        prompt:
          "What must your design persist before acknowledging a notification request so that a restart does not lose accepted work?",
        concern: "STATE",
        componentKinds: ["api_service", "message_queue", "database"],
        pathKinds: ["api_service", "message_queue"],
        coverageTerms: ["acknowledgment", "durable", "persist"],
      },
      {
        id: "notification-system.retry-budget",
        prompt:
          "How does your delivery path distinguish a temporary provider rejection from work that should stop retrying?",
        concern: "TRADEOFF",
        componentKinds: ["worker", "external_service"],
        pathKinds: ["worker", "external_service"],
        coverageTerms: ["permanent", "retry", "backoff"],
      },
    ],
    final:
      "The SMS provider is unavailable for 30 minutes. How does your design recover accepted SMS work without overwhelming the provider when it returns?",
  },
  "url-shortener": {
    opening:
      "Using your diagram, trace a link's creation and a later redirect, showing where the authoritative URL mapping is read and written.",
    middle: [
      {
        id: "url-shortener.code-collision",
        prompt:
          "Two create requests generate the same code. How does your create path choose the winning mapping without overwriting an existing link?",
        concern: "STATE",
        componentKinds: ["api_service", "database"],
        coverageTerms: ["collision", "unique", "retry"],
      },
      {
        id: "url-shortener.read-after-create",
        prompt:
          "A newly created link is requested immediately. How does your redirect path make sure it finds the mapping?",
        concern: "STATE",
        componentKinds: ["database", "api_service"],
        pathKinds: ["api_service", "database"],
        coverageTerms: ["replica", "lag", "primary"],
      },
      {
        id: "url-shortener.lookup-miss",
        prompt:
          "When a redirect lookup is not cached, how does your design find the destination without returning the wrong mapping?",
        concern: "FLOW",
        componentKinds: ["cache", "database"],
        coverageTerms: ["cache", "miss", "mapping"],
      },
    ],
    final:
      "One short link receives most redirect traffic. How does your design absorb that load without overwhelming the mapping store?",
  },
  "rate-limiter": {
    opening:
      "Trace one API request through your limiter, showing which state your chosen algorithm uses to admit or reject it.",
    middle: [
      {
        id: "rate-limiter.concurrent-admission",
        prompt:
          "Two servers check the same API key concurrently. How does your design keep combined admissions within the tolerance you stated?",
        concern: "STATE",
        componentKinds: ["api_service", "cache", "database"],
        coverageTerms: ["atomic", "concurrent", "quota"],
      },
      {
        id: "rate-limiter.burst-boundary",
        prompt:
          "A client sends a burst across a quota boundary. What does your chosen algorithm admit?",
        concern: "TRADEOFF",
        componentKinds: ["api_service", "cache"],
        coverageTerms: ["burst", "window", "tokens"],
      },
      {
        id: "rate-limiter.coordination",
        prompt:
          "What can your admission path decide locally, and what state must be coordinated to enforce the quota?",
        concern: "TRADEOFF",
        componentKinds: ["api_service", "cache", "database"],
        coverageTerms: ["local", "coordination", "tolerance"],
      },
    ],
    final:
      "The limiter's shared state becomes unavailable. What policy does your design apply to balance continued API availability against overload protection?",
  },
  "chat-application": {
    opening:
      "In your diagram, how does one message move from the sender to online delivery or offline storage before the sender receives confirmation?",
    middle: [
      {
        id: "chat-application.message-order",
        prompt:
          "Two participants send messages concurrently in one conversation. Where does your design establish their order, and how do clients preserve it?",
        concern: "STATE",
        componentKinds: ["api_service", "database", "message_queue"],
        coverageTerms: ["sequence", "order", "conversation"],
      },
      {
        id: "chat-application.reconnect-position",
        prompt:
          "When an offline client reconnects, how does your design determine which stored messages that client still needs?",
        concern: "STATE",
        componentKinds: ["client", "database"],
        coverageTerms: ["cursor", "reconnect", "sequence"],
      },
      {
        id: "chat-application.sender-confirmation",
        prompt:
          "What does your sender confirmation guarantee if the recipient is offline when a message is accepted?",
        concern: "STATE",
        componentKinds: ["api_service", "database"],
        coverageTerms: ["acknowledgment", "durable", "offline"],
      },
    ],
    final:
      "A connection server crashes with messages in flight. How do affected clients reconnect and recover missing messages without displaying duplicates?",
  },
  "file-storage": {
    opening:
      "Using your diagram, trace a large upload and a later authorized download, showing where file bytes and metadata live.",
    middle: [
      {
        id: "file-storage.transfer-resume",
        prompt:
          "An upload disconnects halfway through. How does your design identify what has already arrived so the client can resume safely?",
        concern: "STATE",
        componentKinds: ["client", "object_storage", "database"],
        coverageTerms: ["upload", "resume", "parts"],
      },
      {
        id: "file-storage.private-download",
        prompt:
          "Where does your download path check that the requester owns the private file before allowing access to its bytes?",
        concern: "STATE",
        componentKinds: ["api_service", "object_storage"],
        coverageTerms: ["owner", "authorization", "download"],
      },
      {
        id: "file-storage.upload-ready",
        prompt:
          "What completion signal makes a newly uploaded file visible to its owner in your design?",
        concern: "STATE",
        componentKinds: ["database", "object_storage"],
        coverageTerms: ["complete", "visible", "metadata"],
      },
    ],
    final:
      "Metadata exists but the upload never completes. How does your design prevent a broken download and eventually clean up the incomplete upload?",
  },
  "job-queue": {
    opening:
      "Trace one job from submission through durable storage to worker acknowledgment in your diagram.",
    middle: [
      {
        id: "job-queue.repeat-execution",
        prompt:
          "A worker completes its work but crashes before acknowledgment. How does your design handle the next delivery without repeating an unwanted side effect?",
        concern: "STATE",
        componentKinds: ["worker", "message_queue", "database"],
        coverageTerms: ["acknowledgment", "duplicate", "idempotency"],
      },
      {
        id: "job-queue.work-ownership",
        prompt:
          "How does your design decide that a claimed job can safely be handed to another worker?",
        concern: "STATE",
        componentKinds: ["worker", "message_queue"],
        pathKinds: ["message_queue", "worker"],
        coverageTerms: ["lease", "timeout", "ownership"],
      },
      {
        id: "job-queue.retry-budget",
        prompt:
          "How does your design choose when a failed job should retry and when it should stop?",
        concern: "TRADEOFF",
        componentKinds: ["worker", "message_queue"],
        coverageTerms: ["backoff", "attempts", "permanent"],
      },
    ],
    final:
      "One job keeps failing. How does your design stop its retries from delaying unrelated jobs?",
  },
  "news-feed": {
    opening:
      "Trace what happens between publishing a post and a follower seeing it in their feed.",
    middle: [
      {
        id: "news-feed.feed-assembly",
        prompt:
          "Where does your design assemble a user's feed, and what tradeoff does that create between publishing work and reading work?",
        concern: "TRADEOFF",
        componentKinds: ["api_service", "database", "worker"],
        coverageTerms: ["fan-out", "read", "write"],
      },
      {
        id: "news-feed.freshness",
        prompt:
          "What bounds the delay between a successful post and its appearance in a follower's feed?",
        concern: "TRADEOFF",
        componentKinds: ["worker", "message_queue", "database"],
        coverageTerms: ["freshness", "lag", "delay"],
      },
      {
        id: "news-feed.uncached-read",
        prompt:
          "If a user's feed response is not cached, what work must finish before your design returns it?",
        concern: "FLOW",
        componentKinds: ["cache", "database", "api_service"],
        coverageTerms: ["cache", "miss", "assemble"],
      },
    ],
    final:
      "An account with ten million followers posts. How would your design keep feed requests responsive while handling that publication?",
  },
  "ride-hailing": {
    opening:
      "Trace a ride request from the rider through an offer to a driver's confirmed acceptance.",
    middle: [
      {
        id: "ride-hailing.location-freshness",
        prompt:
          "How would your matcher find nearby available drivers quickly when their reported locations may be a few seconds old?",
        concern: "TRADEOFF",
        componentKinds: ["api_service", "cache", "database"],
        coverageTerms: ["location", "stale", "nearby"],
      },
      {
        id: "ride-hailing.offer-confirmation",
        prompt:
          "When a driver accepts an offer, where does your design decide that the match is confirmed?",
        concern: "STATE",
        componentKinds: ["api_service", "database"],
        coverageTerms: ["accept", "confirmed", "assignment"],
      },
      {
        id: "ride-hailing.declined-offer",
        prompt:
          "A driver declines an offer. How does your design choose another driver without confirming two assignments?",
        concern: "STATE",
        componentKinds: ["api_service", "database"],
        coverageTerms: ["decline", "offer", "assignment"],
      },
    ],
    final:
      "Two drivers accept offers for the same rider almost simultaneously. Where does your design decide which assignment succeeds?",
  },
  "video-streaming": {
    opening:
      "Trace an uploaded video through storage and processing to a viewer's playback request in your diagram.",
    middle: [
      {
        id: "video-streaming.playback-ready",
        prompt:
          "Where does your design decide that an uploaded video is ready for playback?",
        concern: "STATE",
        componentKinds: ["worker", "database", "object_storage"],
        coverageTerms: ["processing", "ready", "publish"],
      },
      {
        id: "video-streaming.original-durability",
        prompt:
          "What does your upload acknowledgment guarantee if video processing has not started yet?",
        concern: "STATE",
        componentKinds: ["api_service", "object_storage"],
        coverageTerms: ["original", "durable", "acknowledgment"],
      },
      {
        id: "video-streaming.delivery-work",
        prompt:
          "A playable video becomes popular. Which work belongs on the playback path, and what can happen before viewers request it?",
        concern: "TRADEOFF",
        componentKinds: ["cdn", "object_storage", "api_service"],
        coverageTerms: ["playback", "cache", "delivery"],
      },
    ],
    final:
      "Uploads arrive faster than videos can be processed. How does your design control the backlog without disrupting existing playback?",
  },
  "ticket-booking": {
    opening:
      "Trace a selected seat through a temporary hold to a confirmed booking in your diagram.",
    middle: [
      {
        id: "ticket-booking.competing-holds",
        prompt:
          "Two customers try to hold the same seat simultaneously. Which part of your design chooses the winner?",
        concern: "STATE",
        componentKinds: ["api_service", "database"],
        coverageTerms: ["atomic", "hold", "concurrent"],
      },
      {
        id: "ticket-booking.payment-expiry",
        prompt:
          "Payment confirmation arrives as a seat hold expires. Where does your design decide whether the booking succeeds?",
        concern: "STATE",
        componentKinds: ["api_service", "database", "external_service"],
        coverageTerms: ["payment", "expiry", "confirmed"],
      },
      {
        id: "ticket-booking.stale-seat-map",
        prompt:
          "Availability shown to a customer is stale. Where is the authoritative seat check made when they request a hold?",
        concern: "STATE",
        componentKinds: ["api_service", "database", "cache"],
        coverageTerms: ["inventory", "authoritative", "hold"],
      },
    ],
    final:
      "A popular event opens and traffic spikes immediately. How does your design protect inventory while keeping reservation requests responsive?",
  },
};
