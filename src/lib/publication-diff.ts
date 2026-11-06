import type { Shift } from "./types";

export interface PublicationChange { shiftId: string; before: Shift | null; after: Shift | null }

export function publicationChanges(before: Shift[], after: Shift[]): PublicationChange[] {
  const old = new Map(before.map(shift => [shift.id, shift]));
  const next = new Map(after.map(shift => [shift.id, shift]));
  return [...new Set([...old.keys(), ...next.keys()])].flatMap(shiftId => {
    const a = old.get(shiftId) ?? null, b = next.get(shiftId) ?? null;
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ shiftId, before: a, after: b }];
  });
}

/** Public, personal work facts only: notes, locks and colleagues are irrelevant. */
export interface PersonalPublishedWork {
  shiftId: string;
  title: string;
  group: Shift["group"];
  start: string;
  end: string;
}

export function personalPublication(shifts: Shift[], employeeId: string): PersonalPublishedWork[] {
  return shifts.flatMap(shift => {
    const pieces = shift.assignments.filter(assignment => assignment.employeeId === employeeId)
      .map(assignment => ({ start: Date.parse(assignment.start), end: Date.parse(assignment.end) }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const periods: { start: number; end: number }[] = [];
    for (const piece of pieces) {
      const previous = periods.at(-1);
      // An internal split of unchanged work is not a new personal schedule event.
      if (previous && piece.start <= previous.end) previous.end = Math.max(previous.end, piece.end);
      else periods.push({ ...piece });
    }
    return periods.map(period => ({ shiftId: shift.id, title: shift.title, group: shift.group,
      start: new Date(period.start).toISOString(), end: new Date(period.end).toISOString(),
    }));
  }).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.shiftId.localeCompare(b.shiftId));
}

export function affectedEmployeeIds(before: Shift[], after: Shift[]): string[] {
  return [...new Set([...before, ...after].flatMap(s => s.assignments.map(a => a.employeeId)))].filter(id =>
    JSON.stringify(personalPublication(before, id)) !== JSON.stringify(personalPublication(after, id)),
  ).sort();
}
