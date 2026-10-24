CREATE TABLE "Report" (
  "id" TEXT NOT NULL,
  "interviewId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mode" "InterviewMode" NOT NULL,
  "title" TEXT NOT NULL,
  "score" INTEGER,
  "dimensions" JSONB NOT NULL,
  "strengths" TEXT[] NOT NULL,
  "weaknesses" TEXT[] NOT NULL,
  "feedback" TEXT NOT NULL,
  "evidence" JSONB,
  "coverage" JSONB,
  "summary" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Report_interviewId_key" ON "Report"("interviewId");
CREATE INDEX "Report_userId_completedAt_idx" ON "Report"("userId", "completedAt");
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InterviewCleanup" (
  "interviewId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewCleanup_pkey" PRIMARY KEY ("interviewId")
);
CREATE INDEX "InterviewCleanup_status_updatedAt_idx" ON "InterviewCleanup"("status", "updatedAt");

CREATE TABLE "InterviewMemoryProjection" (
  "interviewId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "projectedVersion" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewMemoryProjection_pkey" PRIMARY KEY ("interviewId")
);
CREATE INDEX "InterviewMemoryProjection_version_projectedVersion_idx" ON "InterviewMemoryProjection"("version", "projectedVersion");
ALTER TABLE "InterviewMemoryProjection" ADD CONSTRAINT "InterviewMemoryProjection_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve reports from interviews completed before this migration. Raw data
-- remains until the application can run its graph-aware cleanup reconciler.
INSERT INTO "Report" ("id", "interviewId", "userId", "mode", "title", "score", "dimensions", "strengths", "weaknesses", "feedback", "evidence", "summary", "completedAt")
SELECT 'report_' || i."id", i."id", i."userId", i."mode",
  CASE WHEN i."mode" = 'SYSTEM_DESIGN' THEN COALESCE(i."name", 'System design interview')
       ELSE COALESCE(i."owner" || '/' || i."name", 'Repository interview') END,
  e."score", e."dimensions", e."strengths", e."weaknesses", e."feedback", NULL,
  jsonb_build_object(
    'repository', CASE WHEN i."mode" = 'SYSTEM_DESIGN' THEN COALESCE(i."name", 'System design interview') ELSE COALESCE(i."owner" || '/' || i."name", 'Repository interview') END,
    'candidateTurns', (SELECT count(*) FROM "ConversationTurn" t WHERE t."interviewId" = i."id" AND t."role" = 'user'),
    'answeredQuestions', (SELECT count(DISTINCT t."questionId") FROM "ConversationTurn" t WHERE t."interviewId" = i."id" AND t."role" = 'user'),
    'analyzedTurns', (SELECT count(*) FROM "ConversationTurn" t WHERE t."interviewId" = i."id" AND t."role" = 'user' AND t."analysisStatus" = 'completed'),
    'failedAnalyses', (SELECT count(*) FROM "ConversationTurn" t WHERE t."interviewId" = i."id" AND t."role" = 'user' AND t."analysisStatus" = 'failed'),
    'durationSeconds', CASE WHEN i."startedAt" IS NULL THEN NULL ELSE GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(i."completedAt", e."createdAt") - i."startedAt"))::integer) END
  ),
  COALESCE(i."completedAt", e."createdAt")
FROM "Interview" i JOIN "Evaluation" e ON e."interviewId" = i."id"
WHERE i."status" = 'completed' AND e."status" = 'completed';

INSERT INTO "InterviewCleanup" ("interviewId", "updatedAt")
SELECT "interviewId", CURRENT_TIMESTAMP FROM "Report";
