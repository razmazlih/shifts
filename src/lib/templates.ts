import { randomUUID } from "node:crypto";
import { z } from "zod";
import { addDays, localDate, localToISO, weekDates } from "./time";
import type { Shift } from "./types";
import { ApiError, shiftsSchema } from "./validation";
import { moveShifts } from "./weeks";

const templateClock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const templateEntriesSchema = z.array(z.object({
  title: z.string().trim().min(1).max(120),
  group: z.enum(["MANAGERS", "PATROL"]),
  startTime: templateClock,
  endTime: templateClock,
  endDayOffset: z.number().int().min(0).max(2).optional(),
  required: z.number().int().min(1).max(50),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, "יש לבחור כל יום פעם אחת"),
}).strict().refine(entry => entry.endDayOffset === undefined || (entry.endDayOffset !== 0 || entry.endTime > entry.startTime) && (entry.endDayOffset !== 2 || entry.endTime <= entry.startTime), "משך משמרת חייב להיות חיובי ועד 48 שעות")).min(1).max(300).refine(
  (entries) => entries.reduce((sum, entry) => sum + entry.days.length, 0) <= 300,
  "התבנית תיצור יותר מ־300 משמרות בשבוע",
);

/** Build reusable staffing requirements without first creating a draft week. */
export function createTemplateEntries(entries: unknown, sourceWeek: string): Shift[] {
  const definitions = templateEntriesSchema.parse(entries);
  try {
    return checked(definitions.flatMap((entry) => entry.days.map((day) => {
      const date = addDays(sourceWeek, day);
      return {
        id: randomUUID(),
        title: entry.title,
        group: entry.group,
        start: localToISO(date, entry.startTime),
        end: localToISO(addDays(date, entry.endDayOffset ?? (entry.endTime <= entry.startTime ? 1 : 0)), entry.endTime),
        required: entry.required,
        assignments: [],
      };
    })));
  } catch (error) {
    if (error instanceof RangeError)
      throw new ApiError(400, "שעות התבנית נופלות על מעבר שעון. יש לבחור שעות אחרות.");
    throw error;
  }
}

export function templateScope(shifts: Shift[]): "day" | "week" {
  return new Set(shifts.map((shift) => localDate(shift.start))).size === 1
    ? "day"
    : "week";
}

function requirements(shifts: Shift[]): Shift[] {
  return shifts.map((shift) => {
    const clean = { ...shift, assignments: [] };
    delete clean.note;
    return clean;
  });
}

function checked(shifts: Shift[]): Shift[] {
  if (shifts.some(shift => Date.parse(shift.end) <= Date.parse(shift.start) || Date.parse(shift.end) - Date.parse(shift.start) > 48 * 3600000))
    throw new ApiError(400, "משך משמרת בתבנית חייב להיות חיובי ועד 48 שעות");
  if (shifts.length > 300)
    throw new ApiError(400, "התבנית תיצור יותר מ־300 משמרות בשבוע");
  return shiftsSchema.parse(shifts);
}

export function createTemplateShifts(
  shifts: Shift[], weekStart: string, sourceDay?: number, repeatAllDays = false,
): Shift[] {
  if (repeatAllDays && sourceDay === undefined)
    throw new ApiError(400, "יש לבחור יום מקור לשכפול לכל השבוע");
  const selected = requirements(sourceDay === undefined ? shifts : shifts.filter(
    (shift) => localDate(shift.start) === addDays(weekStart, sourceDay),
  ));
  if (!selected.length) throw new ApiError(400, "אין משמרות לשמירה בתבנית שנבחרה");
  if (!repeatAllDays) return checked(selected);
  const sourceDate = addDays(weekStart, sourceDay!);
  return checked(weekDates(weekStart).flatMap((day) => moveShifts(selected, sourceDate, day)));
}

export function applyTemplateShifts(
  current: Shift[], template: { shifts: Shift[]; sourceWeek: string },
  targetWeek: string, targetDay?: number, allDays = false,
): Shift[] {
  const clean = requirements(template.shifts);
  if (targetDay !== undefined && allDays)
    throw new ApiError(400, "יש לבחור יום יעד או את כל השבוע");
  if (templateScope(clean) === "week") {
    if (targetDay !== undefined || allDays)
      throw new ApiError(400, "ניתן להחיל תבנית שבועית על שבוע שלם בלבד");
    return checked(moveShifts(clean, template.sourceWeek, targetWeek));
  }
  // Preserve whole-week application for existing API clients without a target.
  if (targetDay === undefined && !allDays)
    return checked(moveShifts(clean, template.sourceWeek, targetWeek));
  const sourceDate = localDate(clean[0].start);
  if (allDays)
    return checked(weekDates(targetWeek).flatMap((day) => moveShifts(clean, sourceDate, day)));
  const targetDate = addDays(targetWeek, targetDay!);
  return checked([
    ...current.filter((shift) => localDate(shift.start) !== targetDate),
    ...moveShifts(clean, sourceDate, targetDate),
  ]);
}
