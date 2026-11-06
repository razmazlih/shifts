import { describe, expect, it } from "vitest";
import { getTimelineRange, layoutTimelineShifts } from "../src/lib/timeline";
import { localToISO } from "../src/lib/time";
import type { Shift } from "../src/lib/types";

function shift(id: string, start: string, end: string, endDate = "2026-11-06"): Shift {
  return { id, title: id, group: "MANAGERS", required: 1, assignments: [],
    start: localToISO("2026-11-06", start), end: localToISO(endDate, end) };
}

describe("timeline geometry", () => {
  it("uses a useful empty range and rounds occupied bounds to complete hours", () => {
    expect(getTimelineRange([])).toEqual({ start: 420, end: 1380 });
    expect(getTimelineRange([shift("a", "08:15", "16:45")])).toEqual({ start: 480, end: 1020 });
  });

  it("extends overnight shifts into the next day without changing their start column", () => {
    const night = shift("night", "22:00", "06:00", "2026-11-07");
    expect(getTimelineRange([night])).toEqual({ start: 1320, end: 1800 });
    expect(layoutTimelineShifts([night])[0]).toMatchObject({ start: 1320, end: 1800, column: 0, columns: 1 });
  });

  it("places touching shifts in separate full-width clusters", () => {
    const result = layoutTimelineShifts([shift("b", "10:00", "12:00"), shift("a", "08:00", "10:00")]);
    expect(result.map(({ shift, column, columns }) => [shift.id, column, columns])).toEqual([["a", 0, 1], ["b", 0, 1]]);
  });

  it("packs connected overlap groups with reusable columns and resets width after gaps", () => {
    const input = [shift("a", "08:00", "12:00"), shift("b", "09:00", "10:00"), shift("c", "10:00", "13:00"), shift("d", "11:00", "14:00"), shift("e", "15:00", "16:00")];
    const result = layoutTimelineShifts(input);
    expect(result.map(({ column, columns }) => [column, columns])).toEqual([[0, 3], [1, 3], [1, 3], [2, 3], [0, 1]]);
    expect(input[0]).not.toHaveProperty("column");
    for (const a of result) for (const b of result) {
      if (a !== b && a.start < b.end && b.start < a.end) expect(a.column).not.toBe(b.column);
    }
  });

  it("keeps civil hours across DST and gives repeated-hour shifts positive height", () => {
    const overnight = { ...shift("dst", "22:00", "06:00"), start: localToISO("2026-10-24", "22:00"), end: localToISO("2026-10-25", "06:00") };
    expect(layoutTimelineShifts([overnight])[0]).toMatchObject({ start: 1320, end: 1800 });
    const repeated = { ...overnight, start: localToISO("2026-10-25", "01:45", "earlier"), end: localToISO("2026-10-25", "01:15", "later") };
    const result = layoutTimelineShifts([repeated])[0];
    expect(result.end - result.start).toBe(30);
  });
});
