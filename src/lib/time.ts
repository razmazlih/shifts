import { Temporal } from "@js-temporal/polyfill";
import type { Shift } from "./types";

export const TIME_ZONE = "Asia/Jerusalem";
export function today(): string {
  return Temporal.Now.plainDateISO(TIME_ZONE).toString();
}
export function weekStart(date = today()): string {
  const day = Temporal.PlainDate.from(date);
  return day.subtract({ days: day.dayOfWeek % 7 }).toString();
}
export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
export function localToISO(
  date: string,
  time: string,
  disambiguation: "earlier" | "later" | "reject" = "reject",
): string {
  return Temporal.PlainDate.from(date)
    .toPlainDateTime(Temporal.PlainTime.from(time))
    .toZonedDateTime(TIME_ZONE, { disambiguation })
    .toInstant()
    .toString();
}
export function localDate(iso: string): string {
  return Temporal.Instant.from(iso)
    .toZonedDateTimeISO(TIME_ZONE)
    .toPlainDate()
    .toString();
}
export function localTime(iso: string): string {
  return Temporal.Instant.from(iso)
    .toZonedDateTimeISO(TIME_ZONE)
    .toPlainTime()
    .toString({ smallestUnit: "minute" });
}
export function weekDates(week: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(week, i));
}

// Copy wall-clock times, including seconds, rather than elapsed milliseconds.
// A destination in a DST gap/fold must be resolved explicitly by the user.
export function shiftByDays(shift: Shift, days: number): Shift {
  const move = (iso: string) => {
    const local = Temporal.Instant.from(iso).toZonedDateTimeISO(TIME_ZONE);
    return localToISO(
      local.toPlainDate().add({ days }).toString(),
      local.toPlainTime().toString(),
    );
  };
  return {
    ...shift,
    start: move(shift.start),
    end: move(shift.end),
    assignments: shift.assignments.map((a) => ({
      ...a,
      start: move(a.start),
      end: move(a.end),
    })),
  };
}
