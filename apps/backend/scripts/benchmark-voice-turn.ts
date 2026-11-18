import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from "@livekit/rtc-node";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@repo/db";
import { loadConfig } from "../src/config.js";
import { SessionService } from "../src/realtime/session.service.js";
import { EvaluationService } from "../src/evaluation/evaluation.service.js";
import { LlmClient } from "../src/llm/llm.client.js";
import {
  aggregateMetrics,
  readUserMetrics,
} from "../src/observability/metrics.js";

if (
  !process.argv.includes("--live") ||
  !process.argv.includes("--configured-database")
)
  throw new Error(
    "Pass --live --configured-database for a real synthetic voice turn with temporary account fixtures",
  );
const cfg = loadConfig();
const id = crypto.randomUUID();
const userId = `voice_bench_${id}`;
const interviewId = `voice_${id}`;
const room = new Room();
let source: AudioSource | undefined;
let state = "unknown",
  sawOpening = false,
  replyStarted = false;
let speechEnd: number | undefined, firstReplyAudio: number | undefined;
let firstReplyState: number | undefined;
const audioReaders: Array<Promise<void>> = [];
const wait = async (
  condition: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs: number,
) => {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};
const output = resolve(
  process.env.BENCHMARK_OUTPUT ??
    "../../spec/benchmarks/repository-voice-smoke.json",
);
const wave = await readFile(
  resolve(process.env.BENCHMARK_AUDIO ?? "../../.turbo/voice-smoke/answer.wav"),
);
let dataOffset = 0,
  dataLength = 0;
for (let offset = 12; offset + 8 < wave.length;) {
  const length = wave.readUInt32LE(offset + 4);
  if (wave.toString("ascii", offset, offset + 4) === "data") {
    dataOffset = offset + 8;
    dataLength = length;
    break;
  }
  offset += 8 + length + (length % 2);
}
if (
  !dataOffset ||
  wave.readUInt32LE(24) !== 48000 ||
  wave.readUInt16LE(22) !== 1 ||
  wave.readUInt16LE(34) !== 16
)
  throw new Error("Expected PCM16 mono 48kHz WAV");
const objectives = [
  {
    id: "opening",
    kind: "OPENING",
    phase: "PROJECT_OVERVIEW",
    topic: "Main request flow",
    description: "Trace acceptance through the API, durable queue and worker",
    targetEvidence: ["Explains the durable acceptance boundary"],
    priority: "HIGH",
    status: "NOT_STARTED",
    attempts: 0,
    evidenceIds: [],
    sources: [{ path: "src/jobs.ts" }],
  },
  {
    id: "delivery",
    kind: "REPOSITORY",
    phase: "ARCHITECTURE",
    topic: "Duplicate jobs",
    description: "Explain how job identity supports safe redelivery",
    targetEvidence: ["Explains retry identity and side-effect idempotency"],
    priority: "HIGH",
    status: "NOT_STARTED",
    attempts: 0,
    evidenceIds: [],
    sources: [{ path: "src/jobs.ts" }],
  },
];
await prisma.user.create({
  data: {
    id: userId,
    name: "Synthetic voice benchmark",
    email: `${userId}@example.test`,
    emailVerified: true,
  },
});
try {
  await prisma.interview.create({
    data: {
      id: interviewId,
      userId,
      mode: "GITHUB",
      status: "ready",
      owner: "fixture",
      name: "voice-smoke",
      githubUrl: "https://github.com/fixture/voice-smoke",
    },
  });
  await prisma.interviewPlan.create({
    data: {
      interviewId,
      role: "Engineer",
      difficulty: "mid",
      topics: ["Queue durability"],
      objectives,
    },
  });
  await prisma.repositoryKnowledge.create({
    data: {
      interviewId,
      commitSha: "a".repeat(40),
      files: [
        {
          path: "src/jobs.ts",
          content:
            "export async function accept(job) { await durableQueue.add(job.id, job); return { accepted: true }; }\nexport async function consume(job) { await idempotentEffect(job.id, job); await durableQueue.ack(job.id); }",
        },
      ],
      symbols: [],
      facts: {
        repository: {
          owner: "fixture",
          name: "voice-smoke",
          url: "https://github.com/fixture/voice-smoke",
          commitSha: "a".repeat(40),
        },
        languages: ["TypeScript"],
        technologies: [],
        dependencies: [],
        architecture: {
          summary: "API to durable queue to worker",
          components: ["API", "queue", "worker"],
        },
        importantFiles: [
          { path: "src/jobs.ts", reason: "Acceptance and worker processing" },
        ],
        projectSummary:
          "An API that accepts jobs into a durable queue for asynchronous processing.",
        evidence: [
          {
            claim: "The API waits for the queue before confirming acceptance",
            source: "src/jobs.ts",
          },
        ],
      },
    },
  });
  room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
    const next = participant.attributes["lk.agent.state"];
    if (!next) return;
    state = next;
    if (speechEnd === undefined && next === "speaking") sawOpening = true;
    if (speechEnd !== undefined && next === "speaking") {
      replyStarted = true;
      firstReplyState ??= performance.now();
    }
  });
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== TrackKind.KIND_AUDIO) return;
    const stream = new AudioStream(track);
    audioReaders.push(
      (async () => {
        try {
          for await (const frame of stream) {
            if (speechEnd === undefined || firstReplyAudio !== undefined)
              continue;
            let energy = 0;
            for (const sample of frame.data) energy += sample * sample;
            if (Math.sqrt(energy / Math.max(1, frame.data.length)) > 100)
              firstReplyAudio = performance.now();
          }
        } catch {
          /* Track closes when the test room disconnects. */
        }
      })(),
    );
  });
  const connection = await new SessionService(cfg).startForInterview(
    interviewId,
  );
  console.log(
    `[voice-benchmark] allocated ${interviewId}; waiting for opening`,
  );
  await room.connect(connection.serverUrl, connection.token);
  source = new AudioSource(48000, 1);
  const track = LocalAudioTrack.createAudioTrack("synthetic.candidate", source);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  const publication = await room.localParticipant!.publishTrack(track, options);
  await publication.waitForSubscription();
  await wait(
    () => sawOpening && state === "listening",
    "opening playout",
    70_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
  console.log("[voice-benchmark] publishing scripted candidate answer");
  for (let byte = 0; byte < dataLength; byte += 960) {
    const samples = new Int16Array(480);
    for (let index = 0; index < 480 && byte + index * 2 < dataLength; index++)
      samples[index] = wave.readInt16LE(dataOffset + byte + index * 2);
    await source.captureFrame(new AudioFrame(samples, 48000, 1, 480));
  }
  await source.waitForPlayout();
  speechEnd = performance.now();
  await wait(
    () => firstReplyAudio !== undefined,
    "first response audio",
    40_000,
  );
  await wait(
    () => replyStarted && state === "listening",
    "response playout",
    40_000,
  );
  const firstAudioMs = firstReplyAudio! - speechEnd;
  console.log(
    `[voice-benchmark] candidate playout end to first received non-silent audio: ${firstAudioMs.toFixed(1)} ms`,
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        firstReceivedAudioMs: firstAudioMs,
        reportVerified: false,
        note: "Synthetic PCM-receive smoke measurement; full report/retention validation pending.",
      },
      null,
      2,
    ),
  );
  // END is a durable intent consumed by the running backend, which owns RAM.
  await new EvaluationService(new LlmClient(cfg)).finalize(interviewId);
  await room.disconnect();
  await source.close();
  source = undefined;
  await wait(
    async () => !!(await prisma.report.findUnique({ where: { interviewId } })),
    "report",
    90_000,
  );
  await readUserMetrics(userId);
  const run = await prisma.interviewMetrics.findUniqueOrThrow({
    where: { interviewId },
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        methodology:
          "One scripted Windows speech-synthesis WAV published in real time to a live LiveKit room. Real STT, configured backend model, TTS and worker. Client first audio uses received PCM RMS >100 after candidate AudioSource playout ends; it is not browser-audible timing or a human interview. Opening wait includes the intentional delay, which retained startup metrics adjust separately. Fixture account is deleted afterward. Small smoke test, not a percentile/SLO or semantic-quality benchmark.",
        firstReceivedAudioMs: firstAudioMs,
        agentSpeakingStateMs:
          firstReplyState === undefined ? null : firstReplyState - speechEnd,
        metrics: aggregateMetrics([run]),
        summary: run.summary,
      },
      null,
      2,
    ),
  );
  // Let the normal cleanup evict backend memory before deleting its owner.
  await wait(
    async () =>
      !(await prisma.interview.findUnique({
        where: { id: interviewId },
        select: { id: true },
      })),
    "raw cleanup",
    80_000,
  );
  const verified = JSON.parse(await readFile(output, "utf8"));
  await writeFile(
    output,
    JSON.stringify(
      { ...verified, reportVerified: true, rawCleanupVerified: true },
      null,
      2,
    ),
  );
  console.log(
    `[voice-benchmark] report and retention verified; saved ${output}`,
  );
} finally {
  await room.disconnect().catch(() => {});
  await source?.close().catch(() => {});
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
  dispose();
}
