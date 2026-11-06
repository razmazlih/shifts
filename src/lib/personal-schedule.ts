import { addDays, localDate, weekStart } from "./time";
import type { Group, Shift } from "./types";

/** The personal view deliberately has no employee, note, lock or draft fields. */
export interface PersonalShift {
  key: string;
  shiftId: string;
  title: string;
  group: Group;
  start: string;
  end: string;
  weekStart: string;
}

export interface PersonalSchedule {
  checkedAt: string;
  currentWeek: string;
  currentWeekStatus: "unpublished" | "no-personal-assignment" | "assigned";
  currentShift: PersonalShift | null;
  nextShift: PersonalShift | null;
  upcomingShifts: PersonalShift[];
  availableThrough: string | null;
}

export interface PublishedPersonalWeek {
  weekStart: string;
  publications: { shifts: unknown }[];
}

/** Input contains only the latest publication of each week, never its draft. */
export function personalSchedule(
  weeks: PublishedPersonalWeek[],
  employeeId: string,
  now = new Date(),
): PersonalSchedule {
  const checkedAt = now.toISOString();
  const currentWeek = weekStart(localDate(checkedAt));
  const publishedWeeks = weeks.filter((week) => week.publications.length > 0);
  const assignments = publishedWeeks.flatMap((week) =>
    (week.publications[0].shifts as Shift[]).flatMap((shift) =>
      shift.assignments.flatMap((assignment, index) =>
        assignment.employeeId !== employeeId
          ? []
          : [{
              key: `${week.weekStart}:${shift.id}:${index}`,
              shiftId: shift.id,
              title: shift.title,
              group: shift.group,
              start: assignment.start,
              end: assignment.end,
              weekStart: week.weekStart,
            }],
      ),
    ),
  ).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Date.parse(a.end) - Date.parse(b.end) || a.key.localeCompare(b.key));
  const currentShift = assignments.find((shift) => Date.parse(shift.start) <= now.getTime() && Date.parse(shift.end) > now.getTime()) ?? null;
  const upcomingShifts = assignments.filter((shift) => Date.parse(shift.start) > now.getTime());
  const currentPublished = publishedWeeks.some((week) => week.weekStart === currentWeek);
  const personalThisWeek = assignments.some((shift) => shift.weekStart === currentWeek);
  const availableWeek = publishedWeeks.map((week) => week.weekStart).sort().at(-1);
  return {
    checkedAt,
    currentWeek,
    currentWeekStatus: !currentPublished ? "unpublished" : personalThisWeek ? "assigned" : "no-personal-assignment",
    currentShift,
    nextShift: upcomingShifts[0] ?? null,
    upcomingShifts,
    availableThrough: availableWeek ? addDays(availableWeek, 6) : null,
  };
}

export function personalShiftEndLabel(shift: Pick<PersonalShift, "start" | "end">): string | null {
  const startDate = localDate(shift.start);
  const endDate = localDate(shift.end);
  if (startDate === endDate) return null;
  return endDate === addDays(startDate, 1) ? "הסיום ביום הבא" : `הסיום בתאריך ${endDate}`;
}
