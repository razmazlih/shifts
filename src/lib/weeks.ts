import { Prisma, type Employee as DbEmployee } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { ApiError } from "./validation";
import { DEFAULT_RULES, validateSchedule, autoSchedule } from "./scheduler";
import { addDays, localDate, shiftByDays } from "./time";
import type {
  AutoScheduleSummary,
  Employee,
  Issue,
  Rules,
  SessionUser,
  Shift,
  WeekData,
} from "./types";
export type Tx = Prisma.TransactionClient;
export const asJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function employeeData(e: DbEmployee): Employee {
  return {
    id: e.id,
    name: e.name,
    ...(e.email ? { email: e.email } : {}),
    active: e.active,
    groups: e.groups as Employee["groups"],
    maxWeeklyHours: e.maxWeeklyHours,
    availability: e.availability as unknown as Employee["availability"],
    timeOff: e.timeOff as unknown as Employee["timeOff"],
    preferredDays: e.preferredDays,
  };
}
export const safeEmployee = (e: Employee): Employee => ({
  id: e.id,
  name: e.name,
  active: e.active,
  groups: e.groups,
  maxWeeklyHours: 0,
  availability: [],
  timeOff: [],
  preferredDays: [],
});
export async function getRules(tx: Tx = db): Promise<Rules> {
  const settings = await tx.settings.findUnique({ where: { id: "global" } });
  return settings ? (settings.rules as unknown as Rules) : DEFAULT_RULES;
}
export async function neighborContext(
  weekStart: string,
  tx: Tx = db,
): Promise<Shift[]> {
  const weeks = await tx.week.findMany({
    where: {
      weekStart: { in: [addDays(weekStart, -7), addDays(weekStart, 7)] },
    },
    include: { publications: { orderBy: { revision: "desc" }, take: 1 } },
  });
  // Published commitments are authoritative; otherwise use the neighboring draft.
  return weeks.flatMap(
    (w) => (w.publications[0]?.shifts ?? w.shifts) as unknown as Shift[],
  );
}
export async function getWeekData(
  weekStart: string,
  user: SessionUser,
  version?: "draft" | "published",
  tx: Tx = db,
): Promise<WeekData> {
  const admin = user.role === "ADMIN";
  const [week, rows, rules] = await Promise.all([
    tx.week.findUnique({
      where: { weekStart },
      include: { publications: { orderBy: { revision: "desc" }, take: 1 } },
    }),
    tx.employee.findMany({ orderBy: { name: "asc" } }),
    getRules(tx),
  ]);
  const employees = rows.map(employeeData);
  const publication = week?.publications[0];
  const published = !admin || version === "published";
  const shifts = (published
    ? (publication?.shifts ?? [])
    : (week?.shifts ?? [])) as unknown as Shift[];
  const context = admin ? await neighborContext(weekStart, tx) : [];
  const issues = admin
    ? validateSchedule(shifts, employees, rules, context)
    : [];
  return {
    weekStart,
    shifts: admin
      ? shifts
      : shifts.map((s) => ({
          id: s.id,
          title: s.title,
          group: s.group,
          start: s.start,
          end: s.end,
          required: s.required,
          assignments: s.assignments,
        })),
    revision: published ? (publication?.revision ?? 0) : (week?.revision ?? 0),
    publishedRevision: week?.publishedRevision ?? null,
    publishedAt: week?.publishedAt?.toISOString() ?? null,
    hasDraft: admin && !!week && week.revision !== week.publishedRevision,
    employees: admin ? employees : employees.map(safeEmployee),
    rules: admin ? rules : DEFAULT_RULES,
    issues,
    user,
    ...(admin ? { contextShifts: context } : {}),
  };
}
function verifyWeekShifts(weekStart: string, shifts: Shift[]) {
  const end = addDays(weekStart, 7);
  for (const shift of shifts) {
    const startDate = localDate(shift.start);
    if (startDate < weekStart || startDate >= end)
      throw new ApiError(400, "תחילת כל משמרת חייבת להיות בתוך השבוע הנבחר");
    if (
      Date.parse(shift.end) <= Date.parse(shift.start) ||
      Date.parse(shift.end) - Date.parse(shift.start) > 48 * 3600000
    )
      throw new ApiError(400, "משך המשמרת אינו תקין");
  }
}
export async function mutateWeek(
  user: SessionUser,
  weekStart: string,
  revision: number,
  action: string | (() => string),
  transform: (shifts: Shift[], tx: Tx) => Promise<Shift[]>,
  publish = false,
): Promise<WeekData> {
  if (user.role !== "ADMIN") throw new ApiError(403, "הפעולה מותרת למנהל בלבד");
  return db.$transaction(
    async (tx) => {
      const week = await tx.week.findUnique({ where: { weekStart } });
      if ((week?.revision ?? 0) !== revision)
        throw new ApiError(409, "השבוע השתנה מאז הטעינה. יש לרענן לפני שמירה.");
      if (publish && !week)
        throw new ApiError(400, "יש לשמור טיוטה לפני הפרסום");
      if (publish && week?.publishedRevision === revision)
        throw new ApiError(409, "גרסה זו כבר פורסמה");
      const before = (week?.shifts ?? []) as unknown as Shift[];
      const shifts = await transform(before, tx);
      verifyWeekShifts(weekStart, shifts);
      // The scheduler deduplicates context by shift ID; cross-week reuse must never hide a commitment.
      const neighbors = await tx.week.findMany({
        where: {
          weekStart: { in: [addDays(weekStart, -7), addDays(weekStart, 7)] },
        },
        include: { publications: { orderBy: { revision: "desc" }, take: 1 } },
      });
      const neighboringIds = new Set(
        neighbors
          .flatMap((w) => [
            ...(w.shifts as unknown as Shift[]),
            ...((w.publications[0]?.shifts as unknown as Shift[]) ?? []),
          ])
          .map((s) => s.id),
      );
      if (shifts.some((s) => neighboringIds.has(s.id)))
        throw new ApiError(
          400,
          "מזהה משמרת כבר קיים בשבוע סמוך. יש ליצור מזהה חדש.",
        );
      const employees = (await tx.employee.findMany()).map(employeeData);
      // Even an invalid draft cannot introduce a dangling employee reference.
      const ids = new Set(employees.map((e) => e.id));
      if (shifts.some((s) => s.assignments.some((a) => !ids.has(a.employeeId))))
        throw new ApiError(400, "עובד משובץ לא נמצא במערכת");
      const rules = await getRules(tx);
      if (publish) {
        const issues = validateSchedule(
          shifts,
          employees,
          rules,
          await neighborContext(weekStart, tx),
        );
        if (issues.some((i) => i.severity === "error"))
          throw new ApiError(
            422,
            "לא ניתן לפרסם שיבוץ עם התנגשויות. יש לתקן את השגיאות.",
            issues,
          );
      }
      const nextRevision = revision + 1;
      const now = new Date();
      if (week) {
        const changed = await tx.week.updateMany({
          where: { weekStart, revision },
          data: {
            shifts: asJson(shifts),
            revision: nextRevision,
            ...(publish
              ? { publishedAt: now, publishedRevision: nextRevision }
              : {}),
          },
        });
        if (!changed.count) throw new ApiError(409, "השבוע השתנה. יש לרענן.");
      } else
        await tx.week.create({
          data: { weekStart, shifts: asJson(shifts), revision: nextRevision },
        });
      if (publish)
        await tx.publication.create({
          data: {
            weekStart,
            revision: nextRevision,
            shifts: asJson(shifts),
            actorId: user.id,
          },
        });
      await tx.audit.create({
        data: {
          weekStart,
          revision: nextRevision,
          action: typeof action === "function" ? action() : action,
          beforeShifts: asJson(before),
          afterShifts: asJson(shifts),
          actorId: user.id,
        },
      });
      return getWeekData(weekStart, user, undefined, tx);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20000,
    },
  );
}
export function moveShifts(
  shifts: Shift[],
  sourceWeek: string,
  targetWeek: string,
): Shift[] {
  const days = Math.round(
    (Date.parse(targetWeek + "T00:00:00Z") -
      Date.parse(sourceWeek + "T00:00:00Z")) /
      86400000,
  );
  try {
    return shifts.map((s) => ({ ...shiftByDays(s, days), id: randomUUID() }));
  } catch (error) {
    if (error instanceof RangeError)
      throw new ApiError(
        400,
        "ההעתקה נופלת על מעבר שעון. יש להתאים את שעות המשמרות ידנית.",
      );
    throw error;
  }
}
export async function autoWeek(
  user: SessionUser,
  week: string,
  revision: number,
  prepare?: (shifts: Shift[], tx: Tx) => Promise<Shift[]>,
) {
  let reasons: Issue[] = [];
  let autoSummary: AutoScheduleSummary | undefined;
  const result = await mutateWeek(
    user,
    week,
    revision,
    prepare ? "TEMPLATE_AUTO" : "AUTO",
    async (current, tx) => {
      const shifts = prepare ? await prepare(current, tx) : current;
      if (!shifts.length)
        throw new ApiError(400, "יש ליצור משמרות לפני השיבוץ האוטומטי");
      const employees = (await tx.employee.findMany()).map(employeeData);
      const rules = await getRules(tx);
      const context = await neighborContext(week, tx);
      const beforeErrors = validateSchedule(shifts, employees, rules, context)
        .filter((issue) => issue.severity === "error");
      const scheduled = autoSchedule(shifts, employees, rules, context);
      const remaining = scheduled.issues.filter((issue) => issue.severity === "error");
      const key = (issue: Issue) => JSON.stringify([issue.shiftId, issue.employeeId, issue.code, issue.message]);
      const remainingKeys = new Set(remaining.map(key));
      autoSummary = {
        changedShiftIds: scheduled.shifts.filter((shift, index) =>
          JSON.stringify(shift.assignments) !== JSON.stringify(shifts[index].assignments)
        ).map((shift) => shift.id),
        resolvedErrors: beforeErrors.filter((issue) => !remainingKeys.has(key(issue))).length,
        remainingErrors: remaining.length,
        unfilledShifts: new Set(scheduled.issues.filter((issue) => issue.code === "UNDERSTAFFED").map((issue) => issue.shiftId)).size,
      };
      reasons = scheduled.issues;
      return scheduled.shifts;
    },
  );
  const seen = new Set(result.issues.map((issue) => JSON.stringify(issue)));
  result.issues.push(
    ...reasons.filter((issue) => !seen.has(JSON.stringify(issue))),
  );
  return { ...result, autoSummary };
}

/** Walk the edit history, skipping publication events and revisions already undone. */
export function undoTarget<T extends { revision: number; action: string }>(
  history: T[],
): T | undefined {
  const undone = new Set(
    history
      .filter((h) => h.action.startsWith("UNDO:"))
      .map((h) => Number(h.action.slice(5))),
  );
  return [...history]
    .sort((a, b) => b.revision - a.revision)
    .find(
      (h) =>
        h.action !== "PUBLISH" &&
        h.action !== "SEED" &&
        !h.action.startsWith("UNDO") &&
        !undone.has(h.revision),
    );
}
