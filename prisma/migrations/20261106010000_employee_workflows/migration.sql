-- Additive migration: preserve all existing schedules, publications and templates.
CREATE TYPE "EmployeeRequestKind" AS ENUM ('ABSENCE', 'CONSTRAINT');
CREATE TYPE "EmployeeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
ALTER TABLE "Template" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "EmployeeRequest" (
  "submissionKey" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "kind" "EmployeeRequestKind" NOT NULL,
  "start" TIMESTAMP(3) NOT NULL,
  "end" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" "EmployeeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "decisionNote" TEXT NOT NULL DEFAULT '',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "history" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeRequest_employeeId_createdAt_idx" ON "EmployeeRequest"("employeeId", "createdAt");
CREATE INDEX "EmployeeRequest_status_createdAt_idx" ON "EmployeeRequest"("status", "createdAt");
CREATE UNIQUE INDEX "EmployeeRequest_employeeId_submissionKey_key" ON "EmployeeRequest"("employeeId", "submissionKey");
ALTER TABLE "EmployeeRequest" ADD CONSTRAINT "EmployeeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeRequest" ADD CONSTRAINT "EmployeeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "TemplateFavorite" (
  "userId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  CONSTRAINT "TemplateFavorite_pkey" PRIMARY KEY ("userId", "templateId")
);
ALTER TABLE "TemplateFavorite" ADD CONSTRAINT "TemplateFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateFavorite" ADD CONSTRAINT "TemplateFavorite_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "EmployeeUpdate" (
  "id" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "weekStart" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "openedAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeUpdate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeUpdate_publicationId_employeeId_key" ON "EmployeeUpdate"("publicationId", "employeeId");
CREATE INDEX "EmployeeUpdate_employeeId_createdAt_id_idx" ON "EmployeeUpdate"("employeeId", "createdAt", "id");
ALTER TABLE "EmployeeUpdate" ADD CONSTRAINT "EmployeeUpdate_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeUpdate" ADD CONSTRAINT "EmployeeUpdate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
