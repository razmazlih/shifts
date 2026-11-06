import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./validation";
import { employeeData, getRules, neighborContext, type Tx } from "./weeks";
import { validateSchedule } from "./scheduler";
import { affectedEmployeeIds, publicationChanges } from "./publication-diff";
import type { SessionUser, Shift } from "./types";

export async function publicationReview(weekStart: string, user: SessionUser, tx: Tx) {
  if (user.role !== "ADMIN") throw new ApiError(403, "הפעולה מותרת למנהל בלבד");
  const [week, rows, rules, context] = await Promise.all([
    tx.week.findUnique({ where: { weekStart }, include: { publications: { orderBy: { revision: "desc" }, take: 1 } } }),
    tx.employee.findMany({ orderBy: { id: "asc" } }), getRules(tx), neighborContext(weekStart, tx),
  ]);
  const shifts = (week?.shifts ?? []) as unknown as Shift[];
  const published = (week?.publications[0]?.shifts ?? []) as unknown as Shift[];
  const employees = rows.map(employeeData);
  const issues = validateSchedule(shifts, employees, rules, context);
  const affected = new Set(affectedEmployeeIds(published, shifts));
  const revision = week?.revision ?? 0, publishedRevision = week?.publishedRevision ?? null;
  const reviewToken = createHash("sha256").update(JSON.stringify({ weekStart, revision, publishedRevision, shifts, published,
    employees, rules, context: [...context].sort((a, b) => a.id.localeCompare(b.id)),
  })).digest("hex");
  return {
    weekStart, revision, publishedRevision, reviewToken,
    changes: publicationChanges(published, shifts),
    affectedEmployees: employees.filter(e => affected.has(e.id)).map(e => ({ id: e.id, name: e.name })),
    issues, shortages: issues.filter(i => i.code === "UNDERSTAFFED"),
    empty: shifts.length === 0,
  };
}

export function getPublicationReview(weekStart: string, user: SessionUser) {
  return db.$transaction(tx => publicationReview(weekStart, user, tx), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
