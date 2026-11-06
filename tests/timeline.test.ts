import { describe, expect, it } from "vitest";
import { buildTimelineBands, getTimelineRange, layoutTimelineShifts } from "../src/lib/timeline";
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

describe("shared timeline bands", () => {
  it("combines identical overlaps into one readable band", () => {
    const a = shift("a", "08:00", "10:00");
    const b = shift("b", "08:00", "10:00");
    expect(buildTimelineBands([b, a])).toEqual([
      { start: 480, end: 600, top: 0, height: 200, days: { "2026-11-06": [a, b] } },
    ]);
  });

  it("segments partial overlaps at every membership change and accumulates positions", () => {
    const a = shift("a", "08:00", "11:00");
    const b = shift("b", "10:00", "12:00");
    const bands = buildTimelineBands([a, b]);
    expect(bands.map(({ start, end, days }) => [start, end, days["2026-11-06"].map((item) => item.id)]))
      .toEqual([[480, 600, ["a"]], [600, 660, ["a", "b"]], [660, 720, ["b"]]]);
    expect(bands.map(({ top, height }) => [top, height])).toEqual([[0, 114], [114, 200], [314, 114]]);
  });

  it("leaves gaps empty and does not include a shift after its end", () => {
    const bands = buildTimelineBands([shift("a", "08:00", "09:00"), shift("b", "10:00", "11:00")]);
    expect(bands[1]).toEqual({ start: 540, end: 600, top: 114, height: 28, days: {} });
    expect(bands[2].days["2026-11-06"].map((item) => item.id)).toEqual(["b"]);
    expect(buildTimelineBands([])).toEqual([{ start: 420, end: 1380, top: 0, height: 448, days: {} }]);
  });

  it("aligns dates without pooling their counts and retains overnight start dates", () => {
    const first = shift("a", "22:00", "06:00", "2026-11-07");
    const second = { ...first, id: "b", start: localToISO("2026-11-07", "22:00"), end: localToISO("2026-11-08", "06:00") };
    expect(buildTimelineBands([first, second])).toEqual([
      { start: 1320, end: 1800, top: 0, height: 224, days: { "2026-11-06": [first], "2026-11-07": [second] } },
    ]);
  });

  it("expands brief active periods but keeps surrounding empty minutes proportional", () => {
    const bands = buildTimelineBands([shift("brief", "08:15", "08:20")]);
    expect(bands.map(({ start, end, height }) => [start, end, height])).toEqual([
      [480, 495, 7], [495, 500, 114], [500, 540, 40 / 60 * 28],
    ]);
    expect(bands[2].top).toBe(121);
  });

  it("does not expand carry-over cards when only another day's membership changes", () => {
    const long = ["a", "b", "c"].map((id) => shift(id, "07:00", "16:00"));
    const shorter = { ...shift("other-day", "07:00", "15:00"), start: localToISO("2026-11-07", "07:00"), end: localToISO("2026-11-07", "15:00") };
    const bands = buildTimelineBands([...long, shorter]);
    expect(bands.map(({ start, end, height }) => [start, end, height])).toEqual([
      [420, 900, 286], [900, 960, 28],
    ]);
    expect(bands[1].days["2026-11-06"]).toEqual(long);
    expect(bands[1].days["2026-11-07"]).toBeUndefined();
  });
});
