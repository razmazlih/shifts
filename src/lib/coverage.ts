import { localDate, localTime } from "./time";
import type { Shift } from "./types";

/** Half-open intervals; one person cannot cover two required positions at once. */
export function coverageSpans(shift: Shift): { start: number; end: number; count: number }[] {
  const start = Date.parse(shift.start), end = Date.parse(shift.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const assignments = shift.assignments.map(a => ({ ...a, start: Date.parse(a.start), end: Date.parse(a.end) }))
    .filter(a => Number.isFinite(a.start) && Number.isFinite(a.end) && a.end > a.start);
  const boundaries = [...new Set([start, end, ...assignments.flatMap(a => [
    Math.max(start, Math.min(end, a.start)), Math.max(start, Math.min(end, a.end)),
  ])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((from, i) => ({ start: from, end: boundaries[i + 1],
    count: new Set(assignments.filter(a => a.start <= from && a.end >= boundaries[i + 1]).map(a => a.employeeId)).size,
  }));
}

export interface CoverageGap { start: string; end: string; missing: number; message: string }

export function coverageGaps(shift: Shift): CoverageGap[] {
  const gaps: { start: number; end: number; missing: number }[] = [];
  for (const span of coverageSpans(shift)) {
    const missing = shift.required - span.count;
    if (missing <= 0) continue;
    const previous = gaps.at(-1);
    if (previous?.end === span.start && previous.missing === missing) previous.end = span.end;
    else gaps.push({ start: span.start, end: span.end, missing });
  }
  return gaps.map(gap => {
    const start = new Date(gap.start).toISOString(), end = new Date(gap.end).toISOString();
    const label = (iso: string) => `${localTime(iso)}${localDate(iso) !== localDate(shift.start) ? ` (${localDate(iso)})` : ""}`;
    const role = shift.group === "PATROL" ? "סייר" : "אחמ״ש";
    const missingLabel = gap.missing === 1 ? `חסר ${role}` : `חסרים ${gap.missing} ${shift.group === "PATROL" ? "סיירים" : "אחמ״שים"}`;
    return { start, end, missing: gap.missing, message: `${missingLabel} בין ${label(start)} ל־${label(end)}` };
  });
}
