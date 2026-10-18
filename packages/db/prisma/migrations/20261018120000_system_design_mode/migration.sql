BEGIN;

-- Interview gains an explicit mode. Existing rows are GitHub interviews.
CREATE TYPE "InterviewMode" AS ENUM ('GITHUB', 'SYSTEM_DESIGN');
CREATE TYPE "DesignGraphStatus" AS ENUM ('BUILDING', 'READY', 'FAILED');

ALTER TABLE "Interview" ADD COLUMN "mode" "InterviewMode" NOT NULL DEFAULT 'GITHUB';
ALTER TABLE "Interview" ADD COLUMN "systemDesignProblemId" TEXT;

-- System design interviews have no repository, so the GitHub-only fields
-- become nullable. GitHub paths guard these fields by mode.
ALTER TABLE "Interview" ALTER COLUMN "githubUrl" DROP NOT NULL;
ALTER TABLE "Interview" ALTER COLUMN "owner" DROP NOT NULL;
ALTER TABLE "Interview" ALTER COLUMN "name" DROP NOT NULL;

CREATE INDEX "Interview_mode_status_idx" ON "Interview"("mode", "status");

CREATE TABLE "SystemDesignSubmission" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "graphStatus" "DesignGraphStatus" NOT NULL DEFAULT 'BUILDING',
    "graphError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "SystemDesignSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemDesignSubmission_requestId_key" ON "SystemDesignSubmission"("requestId");
CREATE UNIQUE INDEX "SystemDesignSubmission_interviewId_revision_key" ON "SystemDesignSubmission"("interviewId", "revision");
CREATE INDEX "SystemDesignSubmission_interviewId_graphStatus_idx" ON "SystemDesignSubmission"("interviewId", "graphStatus");

ALTER TABLE "SystemDesignSubmission"
    ADD CONSTRAINT "SystemDesignSubmission_interviewId_fkey"
    FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
