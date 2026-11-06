import { Temporal } from "@js-temporal/polyfill";
import type { Assignment, Employee, Issue, Rules, Shift } from "./types";
import { TIME_ZONE, addDays, localDate, localToISO, weekStart } from "./time";

export const DEFAULT_RULES: Rules = {
  minRestHours: 8,
  maxShiftHours: 12,
  defaultMaxWeeklyHours: 42,
};
const HOUR = 3_600_000;
type Interval = { start: number; end: number };
type Work = Interval & { employeeId: string; shiftId: string };
const instant = (value: string): number =>
  Temporal.Instant.from(value).epochMilliseconds;
const iso = (value: number): string =>
  Temporal.Instant.fromEpochMilliseconds(value).toString();
function interval(start: string, end: string): Interval | null {
  try {
    const value = { start: instant(start), end: instant(end) };
    return value.end > value.start ? value : null;
  } catch {
    return null;
  }
}
const intersects = (a: Interval, b: Interval) =>
  a.start < b.end && b.start < a.end;
function allShifts(shifts: Shift[], context: Shift[]): Shift[] {
  return [
    ...new Map(
      [...context, ...shifts].map((shift) => [shift.id, shift]),
    ).values(),
  ];
}
function workOf(shifts: Shift[]): Work[] {
  return shifts.flatMap((s) =>
    s.assignments.flatMap((a) => {
      const time = interval(a.start, a.end);
      return time ? [{ ...time, shiftId: s.id, employeeId: a.employeeId }] : [];
    }),
  );
}
function weeklyParts(work: Interval): Map<string, number> {
  const result = new Map<string, number>();
  let cursor = work.start;
  while (cursor < work.end) {
    const week = weekStart(localDate(iso(cursor)));
    const boundary = instant(localToISO(addDays(week, 7), "00:00"));
    const end = Math.min(boundary, work.end);
    result.set(week, (result.get(week) ?? 0) + (end - cursor) / HOUR);
    cursor = end;
  }
  return result;
}
function employeeWeeklyHours(work: Work[], id: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of work.filter((w) => w.employeeId === id))
    for (const [week, hours] of weeklyParts(item))
      result.set(week, (result.get(week) ?? 0) + hours);
  return result;
}
// Recurring availability is a wall-clock interval. During a spring gap its
// boundary is the transition instant, never the invented earlier/later time.
// During an autumn fold it includes both occurrences of an available time.
function availabilityBoundary(
  date: string,
  time: string,
  edge: "start" | "end",
): number {
  const local = Temporal.PlainDate.from(date).toPlainDateTime(
    Temporal.PlainTime.from(time),
  );
  const earlier = local.toZonedDateTime(TIME_ZONE, {
    disambiguation: "earlier",
  });
  if (!earlier.toPlainDateTime().equals(local)) {
    const transition = earlier.getTimeZoneTransition("next");
    if (!transition) throw new RangeError("Missing timezone transition");
    return transition.epochMilliseconds;
  }
  return edge === "start"
    ? earlier.epochMilliseconds
    : local.toZonedDateTime(TIME_ZONE, { disambiguation: "later" })
        .epochMilliseconds;
}
function available(employee: Employee, work: Interval): boolean {
  if (!employee.availability.length) return true;
  const windows: Interval[] = [];
  let date = addDays(localDate(iso(work.start)), -1);
  const last = localDate(iso(work.end));
  while (date <= last) {
    const weekday = Temporal.PlainDate.from(date).dayOfWeek % 7;
    for (const item of employee.availability.filter((a) => a.day === weekday)) {
      try {
        // An availability window spans all occurrences of a repeated clock time.
        const endDate = item.end <= item.start ? addDays(date, 1) : date;
        const start = availabilityBoundary(date, item.start, "start");
        const end = availabilityBoundary(endDate, item.end, "end");
        if (end > start) windows.push({ start, end });
      } catch {
        /* Invalid availability cannot grant availability. */
      }
    }
    date = addDays(date, 1);
  }
  let cursor = work.start;
  for (const window of windows.sort((a, b) => a.start - b.start)) {
    if (window.start > cursor) break;
    if (window.end > cursor) cursor = window.end;
    if (cursor >= work.end) return true;
  }
  return false;
}
function coverage(
  shift: Shift,
): { start: number; end: number; count: number }[] {
  const bounds = interval(shift.start, shift.end);
  if (!bounds) return [];
  const assignments = shift.assignments
    .map((a) => interval(a.start, a.end))
    .filter((a): a is Interval => !!a);
  const points = [
    ...new Set([
      bounds.start,
      bounds.end,
      ...assignments.flatMap((a) => [
        Math.max(bounds.start, Math.min(bounds.end, a.start)),
        Math.max(bounds.start, Math.min(bounds.end, a.end)),
      ]),
    ]),
  ].sort((a, b) => a - b);
  return points
    .slice(0, -1)
    .map((start, i) => ({
      start,
      end: points[i + 1],
      count: assignments.filter(
        (a) => a.start <= start && a.end >= points[i + 1],
      ).length,
    }));
}

export function validateSchedule(
  shifts: Shift[],
  employees: Employee[],
  rules: Rules,
  context: Shift[] = [],
): Issue[] {
  const issues: Issue[] = [];
  const add = (
    code: string,
    message: string,
    shiftId: string,
    employeeId?: string,
    severity: Issue["severity"] = "error",
  ) => {
    if (
      !issues.some(
        (i) =>
          i.code === code &&
          i.shiftId === shiftId &&
          i.employeeId === employeeId &&
          i.message === message,
      )
    )
      issues.push({
        code,
        message,
        severity,
        shiftId,
        ...(employeeId ? { employeeId } : {}),
      });
  };
  const ids = new Set(shifts.map((s) => s.id));
  if (ids.size !== shifts.length)
    for (const shift of shifts)
      if (shifts.filter((s) => s.id === shift.id).length > 1)
        add("DUPLICATE_SHIFT", "מזהה משמרת כפול", shift.id);
  const combined = allShifts(shifts, context);
  const work = workOf(combined);
  const people = new Map(employees.map((e) => [e.id, e]));
  for (const shift of shifts) {
    const bounds = interval(shift.start, shift.end);
    if (!bounds) {
      add("INVALID_TIME", "זמני המשמרת אינם תקינים", shift.id);
      continue;
    }
    if ((bounds.end - bounds.start) / HOUR > 48) {
      add("SHIFT_TOO_LONG", "משך משמרת יכול להיות עד 48 שעות", shift.id);
      continue;
    }
    if (!Number.isInteger(shift.required) || shift.required < 1)
      add(
        "INVALID_REQUIRED",
        "מספר העובדים הדרוש חייב להיות מספר שלם חיובי",
        shift.id,
      );
    if (shift.group !== "PATROL" && shift.group !== "MANAGERS")
      add("INVALID_GROUP", "קבוצת המשמרת אינה תקינה", shift.id);
    for (const a of shift.assignments) {
      const person = people.get(a.employeeId);
      const time = interval(a.start, a.end);
      if (!time) {
        add(
          "INVALID_ASSIGNMENT_TIME",
          "זמני השיבוץ אינם תקינים",
          shift.id,
          a.employeeId,
        );
        continue;
      }
      if (time.start < bounds.start || time.end > bounds.end)
        add(
          "OUTSIDE_SHIFT",
          "השיבוץ חורג מגבולות המשמרת",
          shift.id,
          a.employeeId,
        );
      if (!person) {
        add("UNKNOWN_EMPLOYEE", "העובד אינו קיים", shift.id, a.employeeId);
        continue;
      }
      if (!person.active)
        add("INACTIVE", "העובד אינו פעיל", shift.id, person.id);
      if (!person.groups.includes(shift.group))
        add("GROUP", "העובד אינו משויך לתפקיד הדרוש", shift.id, person.id);
      if (!available(person, time))
        add("UNAVAILABLE", "השיבוץ מחוץ לשעות הזמינות", shift.id, person.id);
      if (
        person.timeOff.some((off) => {
          const range = interval(off.start, off.end);
          return range && intersects(range, time);
        })
      )
        add("TIME_OFF", "השיבוץ חופף להיעדרות", shift.id, person.id);
    }
    const spans = coverage(shift);
    if (spans.some((s) => s.count < shift.required))
      add(
        "UNDERSTAFFED",
        "חסרים עובדים בחלק משעות המשמרת",
        shift.id,
        undefined,
        "warning",
      );
    if (spans.some((s) => s.count > shift.required))
      add(
        "OVERSTAFFED",
        "מספר המשובצים חורג מהנדרש בחלק משעות המשמרת",
        shift.id,
      );
  }
  for (const person of employees) {
    const own = work
      .filter((w) => w.employeeId === person.id)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    // Detect duplicates/overlaps before coalescing split assignments.
    for (let i = 0; i < own.length; i++)
      for (let j = i + 1; j < own.length && own[j].start < own[i].end; j++) {
        for (const item of [own[i], own[j]].filter((w) => ids.has(w.shiftId)))
          add("OVERLAP", "לעובד יש שיבוצים חופפים", item.shiftId, person.id);
      }
    const blocks: Work[] = [];
    for (const item of own) {
      const last = [...blocks]
        .reverse()
        .find((b) => b.shiftId === item.shiftId && b.end >= item.start);
      if (last) last.end = Math.max(last.end, item.end);
      else blocks.push({ ...item });
    }
    blocks.sort((a, b) => a.start - b.start);
    const continuous: (Interval & { shiftIds: Set<string> })[] = [];
    for (const item of blocks) {
      const last = continuous.at(-1);
      if (last && item.start <= last.end) {
        last.end = Math.max(last.end, item.end);
        last.shiftIds.add(item.shiftId);
      } else
        continuous.push({
          start: item.start,
          end: item.end,
          shiftIds: new Set([item.shiftId]),
        });
    }
    for (const item of continuous)
      if ((item.end - item.start) / HOUR > rules.maxShiftHours)
        for (const id of item.shiftIds)
          if (ids.has(id))
            add(
              "ASSIGNMENT_TOO_LONG",
              "משך העבודה הרצופה של העובד חורג מהמותר",
              id,
              person.id,
            );
    for (let i = 0; i < blocks.length; i++)
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i],
          b = blocks[j];
        if (b.start - a.end >= rules.minRestHours * HOUR && b.start >= a.end)
          break;
        if (!intersects(a, b) && b.start - a.end < rules.minRestHours * HOUR)
          for (const item of [a, b].filter((w) => ids.has(w.shiftId)))
            add(
              "REST",
              "אין מספיק שעות מנוחה בין השיבוצים",
              item.shiftId,
              person.id,
            );
      }
    const totals = employeeWeeklyHours(work, person.id);
    const max = person.maxWeeklyHours ?? rules.defaultMaxWeeklyHours;
    for (const [week, hours] of totals)
      if (hours > max + 1e-9) {
        for (const item of own.filter(
          (w) => ids.has(w.shiftId) && weeklyParts(w).has(week),
        ))
          add(
            "WEEKLY_HOURS",
            `חריגה ממכסת השעות השבועית (${max}) בשבוע ${week}`,
            item.shiftId,
            person.id,
          );
      }
  }
  return issues;
}

function hoursForShift(shift: Shift, all: Shift[], employeeId: string): number {
  const bounds = interval(shift.start, shift.end);
  if (!bounds) return 0;
  const totals = employeeWeeklyHours(workOf(all), employeeId);
  return [...weeklyParts(bounds).keys()].reduce(
    (sum, week) => sum + (totals.get(week) ?? 0),
    0,
  );
}
export function getCandidates(
  shift: Shift,
  shifts: Shift[],
  employees: Employee[],
  rules: Rules,
  context: Shift[] = [],
): {
  employee: Employee;
  eligible: boolean;
  reasons: string[];
  hours: number;
}[] {
  const base = allShifts(shifts, context);
  return employees.map((employee) => {
    const candidate = {
      ...shift,
      assignments: [
        ...shift.assignments.filter((a) => a.employeeId !== employee.id),
        { employeeId: employee.id, start: shift.start, end: shift.end },
      ],
    };
    const reasons = validateSchedule([candidate], employees, rules, base)
      .filter(
        (i) =>
          i.severity === "error" &&
          (!i.employeeId || i.employeeId === employee.id),
      )
      .map((i) => i.message);
    return {
      employee,
      eligible: !reasons.length,
      reasons: [...new Set(reasons)],
      hours: hoursForShift(shift, base, employee.id),
    };
  });
}
function mergeAssignments(assignments: Assignment[]): Assignment[] {
  const result: Assignment[] = [];
  for (const a of [...assignments].sort(
    (a, b) =>
      a.employeeId.localeCompare(b.employeeId) ||
      instant(a.start) - instant(b.start),
  )) {
    const last = result.at(-1);
    if (
      last &&
      last.employeeId === a.employeeId &&
      instant(last.end) === instant(a.start)
    )
      last.end = a.end;
    else result.push({ ...a });
  }
  return result;
}
// Include real availability/time-off edges so an unassigned long shift can be
// covered by several workers, and cap each proposed segment at the work limit.
function autoSpans(
  shift: Shift,
  employees: Employee[],
  rules: Rules,
): { start: number; end: number; count: number }[] {
  const bounds = interval(shift.start, shift.end)!;
  if ((bounds.end - bounds.start) / HOUR > 48) return coverage(shift);
  const cuts = new Set<number>();
  const max = rules.maxShiftHours * HOUR;
  if (max > 0)
    for (let cursor = bounds.start + max; cursor < bounds.end; cursor += max)
      cuts.add(cursor);
  for (const employee of employees) {
    for (const off of employee.timeOff) {
      const range = interval(off.start, off.end);
      if (range) {
        cuts.add(range.start);
        cuts.add(range.end);
      }
    }
    for (
      let date = addDays(localDate(shift.start), -1);
      date <= localDate(shift.end);
      date = addDays(date, 1)
    ) {
      const day = Temporal.PlainDate.from(date).dayOfWeek % 7;
      for (const window of employee.availability.filter((a) => a.day === day)) {
        try {
          cuts.add(availabilityBoundary(date, window.start, "start"));
          cuts.add(
            availabilityBoundary(
              window.end <= window.start ? addDays(date, 1) : date,
              window.end,
              "end",
            ),
          );
        } catch {
          /* Invalid availability never grants eligibility. */
        }
      }
    }
  }
  return coverage(shift).flatMap((span) => {
    const points = [
      span.start,
      ...[...cuts].filter((c) => c > span.start && c < span.end),
      span.end,
    ].sort((a, b) => a - b);
    return points
      .slice(0, -1)
      .map((start, i) => ({ start, end: points[i + 1], count: span.count }));
  });
}
// Keep existing work in a stable chronological order before filling gaps. Each
// retained assignment is checked only against the already accepted work and the
// read-only neighboring context; a conflicting later assignment cannot displace
// an otherwise valid earlier one. No search over assignment combinations is used.
function repairAssignments(
  shifts: Shift[],
  employees: Employee[],
  rules: Rules,
  context: Shift[],
): Set<string> {
  const structuralCodes = new Set([
    "DUPLICATE_SHIFT", "INVALID_TIME", "SHIFT_TOO_LONG",
    "INVALID_REQUIRED", "INVALID_GROUP",
  ]);
  const existingIssues = validateSchedule(shifts, employees, rules, context);
  if (!existingIssues.some((issue) => issue.severity === "error")) return new Set();
  const invalid = new Set(
    existingIssues
      .filter((issue) => structuralCodes.has(issue.code))
      .map((issue) => issue.shiftId),
  );
  const pending = shifts
    .filter((shift) => !invalid.has(shift.id))
    .flatMap((shift) => shift.assignments.map((assignment, index) => ({
      shift, assignment, index,
    })))
    .sort((a, b) =>
      (interval(a.assignment.start, a.assignment.end)?.start ?? Infinity) -
        (interval(b.assignment.start, b.assignment.end)?.start ?? Infinity) ||
      a.shift.id.localeCompare(b.shift.id) ||
      a.assignment.employeeId.localeCompare(b.assignment.employeeId) ||
      a.index - b.index,
    );
  for (const shift of shifts)
    if (!invalid.has(shift.id)) shift.assignments = [];
  for (const { shift, assignment } of pending) {
    const time = interval(assignment.start, assignment.end);
    const bounds = interval(shift.start, shift.end)!;
    if (!time) continue;
    // Clip out-of-bounds work and keep only the portions where another retained
    // worker has not already filled the required staffing level.
    const pieces = coverage(shift).flatMap((span) => {
      const start = Math.max(span.start, time.start, bounds.start);
      const end = Math.min(span.end, time.end, bounds.end);
      return span.count < shift.required && end > start
        ? [{ ...assignment, start: iso(start), end: iso(end) }]
        : [];
    });
    if (!pieces.length) continue;
    const trial = { ...shift, assignments: mergeAssignments([
      ...shift.assignments, ...pieces,
    ]) };
    const errors = validateSchedule([trial], employees, rules, allShifts(shifts, context))
      .filter((issue) => issue.severity === "error" &&
        (!issue.employeeId || issue.employeeId === assignment.employeeId));
    if (!errors.length) shift.assignments = trial.assignments;
  }
  return invalid;
}
export function autoSchedule(
  shifts: Shift[],
  employees: Employee[],
  rules: Rules,
  context: Shift[] = [],
): { shifts: Shift[]; issues: Issue[] } {
  const result = shifts.map((s) => ({
    ...s,
    assignments: s.assignments.map((a) => ({ ...a })),
  }));
  const invalid = repairAssignments(result, employees, rules, context);
  const unfilled: Issue[] = [];
  for (const shift of [...result].sort(
    (a, b) =>
      (interval(a.start, a.end)?.start ?? 0) -
        (interval(b.start, b.end)?.start ?? 0) || a.id.localeCompare(b.id),
  )) {
    if (
      invalid.has(shift.id) ||
      !interval(shift.start, shift.end) ||
      shift.assignments.some((a) => !interval(a.start, a.end)) ||
      !Number.isInteger(shift.required) ||
      shift.required < 1
    )
      continue;
    for (const span of autoSpans(shift, employees, rules)) {
      const missing = shift.required - span.count;
      for (let slot = 0; slot < missing; slot++) {
        const all = allShifts(result, context);
        const options = employees.map((employee) => {
          const trial = {
            ...shift,
            assignments: mergeAssignments([
              ...shift.assignments,
              {
                employeeId: employee.id,
                start: iso(span.start),
                end: iso(span.end),
              },
            ]),
          };
          const errors = validateSchedule(
            [trial],
            employees,
            rules,
            all,
          ).filter(
            (i) =>
              i.severity === "error" &&
              (!i.employeeId || i.employeeId === employee.id),
          );
          return {
            employee,
            trial,
            errors,
            hours: hoursForShift(shift, all, employee.id),
          };
        });
        const day =
          Temporal.Instant.from(shift.start).toZonedDateTimeISO(TIME_ZONE)
            .dayOfWeek % 7;
        const selected = options
          .filter((o) => !o.errors.length)
          .sort(
            (a, b) =>
              a.hours - b.hours ||
              Number(b.employee.preferredDays.includes(day)) -
                Number(a.employee.preferredDays.includes(day)) ||
              a.employee.id.localeCompare(b.employee.id),
          )[0];
        if (!selected) {
          const reasons = [
            ...new Set(options.flatMap((o) => o.errors.map((e) => e.message))),
          ];
          unfilled.push({
            code: "UNFILLED_REASON",
            severity: "warning",
            shiftId: shift.id,
            message: `לא נמצא עובד מתאים: ${reasons.join("; ") || "אין עובדים במערכת"}`,
          });
          break;
        }
        shift.assignments = selected.trial.assignments;
      }
    }
  }
  return {
    shifts: result,
    issues: [
      ...validateSchedule(result, employees, rules, context),
      ...unfilled,
    ],
  };
}
