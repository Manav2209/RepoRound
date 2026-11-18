CREATE TABLE "InterviewMetrics" (
  "interviewId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mode" "InterviewMode" NOT NULL,
  "problemId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'created',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "summary" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewMetrics_pkey" PRIMARY KEY ("interviewId")
);
CREATE INDEX "InterviewMetrics_userId_createdAt_idx" ON "InterviewMetrics"("userId", "createdAt");
ALTER TABLE "InterviewMetrics" ADD CONSTRAINT "InterviewMetrics_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the lifecycle denominator for interviews/reports that already exist.
INSERT INTO "InterviewMetrics" ("interviewId", "userId", "mode", "problemId", "status", "createdAt", "startedAt", "completedAt", "updatedAt")
SELECT "id", "userId", "mode", "systemDesignProblemId", "status"::text, "createdAt", "startedAt", "completedAt", CURRENT_TIMESTAMP
FROM "Interview";
INSERT INTO "InterviewMetrics" ("interviewId", "userId", "mode", "status", "createdAt", "completedAt", "updatedAt")
SELECT "interviewId", "userId", "mode", 'completed', "createdAt", "completedAt", CURRENT_TIMESTAMP
FROM "Report"
ON CONFLICT ("interviewId") DO NOTHING;
