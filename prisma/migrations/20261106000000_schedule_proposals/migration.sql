-- Additive only: existing weeks, snapshots and employee data are unchanged.
CREATE TABLE "ScheduleProposal" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "shifts" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleProposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScheduleProposal_actorId_expiresAt_idx" ON "ScheduleProposal"("actorId", "expiresAt");
ALTER TABLE "ScheduleProposal" ADD CONSTRAINT "ScheduleProposal_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
