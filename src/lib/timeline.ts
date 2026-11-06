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

export interface TimelineBand {
  start: number;
  end: number;
  top: number;
  height: number;
  days: Record<string, Shift[]>;
}

/**
 * Shared boundaries keep every day aligned while allowing short, busy periods
 * enough space for readable full-width rows. Membership is half-open: a shift
 * ending at a boundary never appears in the following band.
 */
export function buildTimelineBands(shifts: Shift[]): TimelineBand[] {
  const range = getTimelineRange(shifts);
  const intervals = shifts.map((shift) => ({ shift, date: localDate(shift.start), ...interval(shift) }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.shift.id.localeCompare(b.shift.id));
  const boundaries = [...new Set([range.start, range.end, ...intervals.flatMap(({ start, end }) => [start, end])])]
    .sort((a, b) => a - b);
  let top = 0;
  let previousDays: Record<string, Shift[]> = {};
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const days: Record<string, Shift[]> = {};
    for (const item of intervals) {
      if (item.start < end && item.end > start) (days[item.date] ??= []).push(item.shift);
    }
    // Identical membership is rendered as one card spanning adjacent bands.
    // Changed cards show new shifts in full and carry-over shifts in compact rows.
    const minimumHeight = Math.max(0, ...Object.entries(days).map(([date, items]) => {
      const previous = previousDays[date];
      const unchanged = previous?.length === items.length && items.every((item, itemIndex) => item.id === previous[itemIndex].id);
      if (unchanged) return 0;
      const previousIds = new Set(previous?.map((item) => item.id));
      const continuing = items.filter((item) => previousIds.has(item.id)).length;
      const newStarts = items.length - continuing;
      return 28 + 80 * newStarts + 30 * continuing;
    }));
    const height = Math.max((end - start) / 60 * 28, minimumHeight);
    const band = { start, end, top, height, days };
    top += height;
    previousDays = days;
    return band;
  });
}
