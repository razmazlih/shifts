import { addDays, localDate, weekDates } from "./time";
import type { Shift } from "./types";
import { ApiError, shiftsSchema } from "./validation";
import { moveShifts } from "./weeks";

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
