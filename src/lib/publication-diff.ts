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
export function personalPublication(shifts: Shift[], employeeId: string) {
  return shifts.flatMap(s => s.assignments.filter(a => a.employeeId === employeeId).map(a => ({
    shiftId: s.id, title: s.title, group: s.group, start: a.start, end: a.end,
  }))).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.shiftId.localeCompare(b.shiftId));
}

export function affectedEmployeeIds(before: Shift[], after: Shift[]): string[] {
  return [...new Set([...before, ...after].flatMap(s => s.assignments.map(a => a.employeeId)))].filter(id =>
    JSON.stringify(personalPublication(before, id)) !== JSON.stringify(personalPublication(after, id)),
  ).sort();
}
