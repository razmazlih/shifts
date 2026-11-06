import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { db } from "./db";
import { TIME_ZONE, addDays, localDate, localToISO, weekStart } from "./time";
import type { Group, SessionUser, Shift } from "./types";
import type { Tx } from "./weeks";

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(
  (value) => Number(value.slice(0, 4)) >= 2 && Number(value.slice(0, 4)) <= 9998,
  "החודש אינו תקין",
);
export interface MonthlyTotals {
  hours: number;
  shifts: number;
  days: number;
  elapsedHours: number;
  remainingHours: number;
  completedShifts: number;
  ongoingShifts: number;
  upcomingShifts: number;
}
export interface MonthlyShift {
  id: string;
  shiftId: string;
  title: string;
  group: Group;
  start: string;
  end: string;
  date: string;
  days: string[];
  hours: number;
  status: "completed" | "ongoing" | "upcoming";
}
export interface MonthlyEmployeeReport {
  id: string;
  name: string;
  active: boolean;
  totals: MonthlyTotals;
  previous: MonthlyTotals;
  shifts: MonthlyShift[];
}
export interface MonthlyReport {
  month: string;
  previousMonth: string;
  generatedAt: string;
  source: "published";
  employees: MonthlyEmployeeReport[];
}
export function monthRange(month: string) {
  const first = Temporal.PlainDate.from(`${month}-01`);
  const next = first.add({ months: 1 });
  return {
    first: first.toString(),
    next: next.toString(),
    previousMonth: first.subtract({ months: 1 }).toString().slice(0, 7),
    start: Date.parse(localToISO(first.toString(), "00:00")),
    end: Date.parse(localToISO(next.toString(), "00:00")),
  };
}

/** Published scheduled time only: this system does not record attendance. */
export function summarizeMonth(
  shifts: Shift[],
  employeeId: string,
  month: string,
  now: Date,
): { totals: MonthlyTotals; shifts: MonthlyShift[] } {
  const { start: monthStart, end: monthEnd } = monthRange(month);
  const nowMs = now.getTime();
  const entries: MonthlyShift[] = [];
  const parentIntervals = new Map<string, { start: number; end: number }>();
  const status = (start: number, end: number): MonthlyShift["status"] =>
    end <= nowMs ? "completed" : start > nowMs ? "upcoming" : "ongoing";
  let totalMs = 0;
  let elapsedMs = 0;
  for (const shift of shifts) {
    for (const [index, assignment] of shift.assignments.entries()) {
      if (assignment.employeeId !== employeeId) continue;
      const startMs = Date.parse(assignment.start);
      const endMs = Date.parse(assignment.end);
      const start = Math.max(startMs, monthStart);
      const end = Math.min(endMs, monthEnd);
      if (!(end > start)) continue;
      const parent = parentIntervals.get(shift.id);
      parentIntervals.set(shift.id, {
        start: Math.min(parent?.start ?? startMs, startMs),
        end: Math.max(parent?.end ?? endMs, endMs),
      });
      const days: string[] = [];
      const lastDate = localDate(new Date(end - 1).toISOString());
      for (let day = localDate(new Date(start).toISOString()); day <= lastDate; day = addDays(day, 1)) days.push(day);
      totalMs += end - start;
      elapsedMs += Math.max(0, Math.min(end, nowMs) - start);
      entries.push({
        id: `${shift.id}:${index}`,
        shiftId: shift.id,
        title: shift.title,
        group: shift.group,
        start: assignment.start,
        end: assignment.end,
        date: days[0],
        days,
        hours: (end - start) / 3600000,
        status: status(startMs, endMs),
      });
    }
  }
  entries.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
  const parentStatuses = [...parentIntervals.values()].map((interval) => status(interval.start, interval.end));
  return {
    totals: {
      hours: totalMs / 3600000,
      shifts: parentIntervals.size,
      days: new Set(entries.flatMap((entry) => entry.days)).size,
      elapsedHours: elapsedMs / 3600000,
      remainingHours: (totalMs - elapsedMs) / 3600000,
      completedShifts: parentStatuses.filter((value) => value === "completed").length,
      ongoingShifts: parentStatuses.filter((value) => value === "ongoing").length,
      upcomingShifts: parentStatuses.filter((value) => value === "upcoming").length,
    },
    shifts: entries,
  };
}

export async function getMonthlyReport(
  month: string,
  user: SessionUser,
  tx: Tx = db,
  now = new Date(),
): Promise<MonthlyReport> {
  monthSchema.parse(month);
  const range = monthRange(month);
  const previousRange = monthRange(range.previousMonth);
  const admin = user.role === "ADMIN";
  const [weeks, employees] = await Promise.all([
    tx.week.findMany({
      // A shift may start in the preceding week and cross a month boundary.
      where: { weekStart: { gte: weekStart(addDays(previousRange.first, -2)), lt: range.next } },
      select: { publications: { orderBy: { revision: "desc" }, take: 1, select: { shifts: true } } },
    }),
    tx.employee.findMany({
      where: admin ? {} : { id: user.employeeId ?? "" },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const published = weeks.flatMap((week) => (week.publications[0]?.shifts ?? []) as unknown as Shift[]);
  // Filter before aggregation so employee reports can never contain coworkers' assignments.
  const visible = admin ? published : published.map((shift) => ({
    ...shift,
    assignments: shift.assignments.filter((assignment) => assignment.employeeId === user.employeeId),
  }));
  const rows = [...employees];
  if (admin) {
    const knownIds = new Set(rows.map((employee) => employee.id));
    for (const shift of visible) for (const assignment of shift.assignments) {
      if (knownIds.has(assignment.employeeId)) continue;
      knownIds.add(assignment.employeeId);
      rows.push({ id: assignment.employeeId, name: "עובד שהוסר", active: false });
    }
  }
  return {
    month,
    previousMonth: range.previousMonth,
    generatedAt: now.toISOString(),
    source: "published",
    employees: rows.map((employee) => {
      const current = summarizeMonth(visible, employee.id, month, now);
      return {
        ...employee,
        totals: current.totals,
        shifts: current.shifts,
        previous: summarizeMonth(visible, employee.id, range.previousMonth, now).totals,
      };
    }),
  };
}

export function currentMonth() {
  return Temporal.Now.plainDateISO(TIME_ZONE).toString().slice(0, 7);
}
