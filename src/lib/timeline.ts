import { localDate, localTime } from "./time";
import type { Shift } from "./types";

export interface TimelineShift {
  shift: Shift;
  start: number;
  end: number;
  column: number;
  columns: number;
}

function clockMinutes(iso: string): number {
  const [hours, minutes] = localTime(iso).split(":").map(Number);
  return hours * 60 + minutes;
}

// Coordinates are civil minutes from midnight on the shift's start date.
// Overnight shifts stay in their starting day's column, below midnight.
function interval(shift: Shift) {
  const start = clockMinutes(shift.start);
  const days = (Date.parse(localDate(shift.end)) - Date.parse(localDate(shift.start))) / 86_400_000;
  const wallEnd = days * 1440 + clockMinutes(shift.end);
  // During the autumn clock change a valid shift can end at an earlier clock
  // reading. Preserve its visibility using elapsed duration in that rare case.
  const end = wallEnd > start ? wallEnd : start + Math.max(1, (Date.parse(shift.end) - Date.parse(shift.start)) / 60_000);
  return { start, end };
}

export function getTimelineRange(shifts: Shift[]): { start: number; end: number } {
  if (shifts.length === 0) return { start: 7 * 60, end: 23 * 60 };
  const intervals = shifts.map(interval);
  return {
    start: Math.floor(Math.min(...intervals.map((item) => item.start)) / 60) * 60,
    end: Math.ceil(Math.max(...intervals.map((item) => item.end)) / 60) * 60,
  };
}

/** Pack a single day's shifts into side-by-side columns within overlap groups. */
export function layoutTimelineShifts(shifts: Shift[]): TimelineShift[] {
  const sorted = shifts.map((shift) => ({ shift, ...interval(shift), column: 0, columns: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.shift.id.localeCompare(b.shift.id));
  let cluster: TimelineShift[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;
  const finishCluster = () => {
    for (const item of cluster) item.columns = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) finishCluster();
    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) column = columnEnds.length;
    item.column = column;
    columnEnds[column] = item.end;
    cluster.push(item);
    clusterEnd = Math.max(cluster.length === 1 ? -Infinity : clusterEnd, item.end);
  }
  finishCluster();
  return sorted;
}
