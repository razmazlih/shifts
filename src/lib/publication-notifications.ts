import { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./validation";
import { personalPublication, type PersonalPublishedWork } from "./publication-diff";
import type { SessionUser, Shift } from "./types";
import type { Tx } from "./weeks";

export interface PersonalPublicationChange {
  shiftId: string;
  kind: "added" | "canceled" | "changed";
  before: PersonalPublishedWork[];
  after: PersonalPublishedWork[];
}
export interface PersonalUpdate {
  id: string;
  weekStart: string;
  publicationRevision: number;
  changes: PersonalPublicationChange[];
  publishedAt: string;
  openedAt: string | null;
  acknowledgedAt: string | null;
}
export interface PersonalUpdatesPage {
  updates: PersonalUpdate[];
  nextCursor: string | null;
  awaitingAcknowledgement: number;
}

export function personalPublicationChanges(before: Shift[], after: Shift[], employeeId: string): PersonalPublicationChange[] {
  const old = personalPublication(before, employeeId), next = personalPublication(after, employeeId);
  return [...new Set([...old, ...next].map(work => work.shiftId))].flatMap(shiftId => {
    const previous = old.filter(work => work.shiftId === shiftId), current = next.filter(work => work.shiftId === shiftId);
    if (JSON.stringify(previous) === JSON.stringify(current)) return [];
    return [{ shiftId, kind: !previous.length ? "added" as const : !current.length ? "canceled" as const : "changed" as const,
      before: previous, after: current }];
  });
}

/** Must run in the same transaction that creates the immutable publication. */
export async function createPublicationUpdates(
  tx: Tx, publicationId: string, weekStart: string, before: Shift[], after: Shift[],
) {
  const employees = [...new Set([...before, ...after].flatMap(shift => shift.assignments.map(assignment => assignment.employeeId)))];
  const data = employees.flatMap(employeeId => {
    const changes = personalPublicationChanges(before, after, employeeId);
    return changes.length ? [{ publicationId, employeeId, weekStart, changes: JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonValue }] : [];
  });
  if (data.length) await tx.employeeUpdate.createMany({ data, skipDuplicates: true });
}

const ownEmployee = (user: SessionUser) => {
  if (!user.employeeId) throw new ApiError(403, "עדכונים אישיים זמינים לחשבון עובד מקושר בלבד");
  return user.employeeId;
};
const updateSelect = {
  id: true, weekStart: true, changes: true, openedAt: true, acknowledgedAt: true,
  publication: { select: { revision: true, createdAt: true } },
} as const;
function projectUpdate(row: {
  id: string; weekStart: string; changes: Prisma.JsonValue; openedAt: Date | null; acknowledgedAt: Date | null;
  publication: { revision: number; createdAt: Date };
}): PersonalUpdate {
  return { id: row.id, weekStart: row.weekStart, changes: row.changes as unknown as PersonalPublicationChange[],
    publicationRevision: row.publication.revision, publishedAt: row.publication.createdAt.toISOString(),
    openedAt: row.openedAt?.toISOString() ?? null, acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null };
}

export async function listPersonalUpdates(user: SessionUser, cursor?: string): Promise<PersonalUpdatesPage> {
  const employeeId = ownEmployee(user);
  return db.$transaction(async tx => {
    const anchor = cursor ? await tx.employeeUpdate.findFirst({ where: { id: cursor, employeeId }, select: { id: true, createdAt: true } }) : null;
    if (cursor && !anchor) throw new ApiError(404, "העדכון לא נמצא");
    const [rows, awaitingAcknowledgement] = await Promise.all([
      tx.employeeUpdate.findMany({
        where: { employeeId, ...(anchor ? { OR: [
          { createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } },
        ] } : {}) },
        select: updateSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
      }),
      tx.employeeUpdate.count({ where: { employeeId, acknowledgedAt: null } }),
    ]);
    return { updates: rows.slice(0, 20).map(projectUpdate), nextCursor: rows.length > 20 ? rows[19].id : null, awaitingAcknowledgement };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function markPersonalUpdate(user: SessionUser, id: string, action: "open" | "acknowledge"): Promise<PersonalUpdate> {
  const employeeId = ownEmployee(user);
  return db.$transaction(async tx => {
    const owned = await tx.employeeUpdate.findFirst({ where: { id, employeeId }, select: { id: true } });
    if (!owned) throw new ApiError(404, "העדכון לא נמצא");
    const now = new Date();
    // Idempotent: a retry never changes the first-open or first-ack timestamp.
    await tx.employeeUpdate.updateMany({ where: { id, employeeId, openedAt: null }, data: { openedAt: now } });
    if (action === "acknowledge")
      await tx.employeeUpdate.updateMany({ where: { id, employeeId, acknowledgedAt: null }, data: { acknowledgedAt: now } });
    const updated = await tx.employeeUpdate.findFirst({ where: { id, employeeId }, select: updateSelect });
    if (!updated) throw new ApiError(404, "העדכון לא נמצא");
    return projectUpdate(updated);
  });
}
