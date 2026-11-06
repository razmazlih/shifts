import { describe, expect, it } from "vitest";
import { buildTimelineBands, getTimelineRange, layoutTimelineShifts, summarizeTimelineShifts } from "../src/lib/timeline";
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
      { start: 480, end: 600, top: 0, height: 188, days: { "2026-11-06": [a, b] } },
    ]);
  });

  it("segments partial overlaps at every membership change and accumulates positions", () => {
    const a = shift("a", "08:00", "11:00");
    const b = shift("b", "10:00", "12:00");
    const bands = buildTimelineBands([a, b]);
    expect(bands.map(({ start, end, days }) => [start, end, days["2026-11-06"].map((item) => item.id)]))
      .toEqual([[480, 600, ["a"]], [600, 660, ["a", "b"]], [660, 720, ["b"]]]);
    expect(bands.map(({ top, height }) => [top, height])).toEqual([[0, 108], [108, 138], [246, 58]]);
  });

  it("leaves gaps empty and does not include a shift after its end", () => {
    const bands = buildTimelineBands([shift("a", "08:00", "09:00"), shift("b", "10:00", "11:00")]);
    expect(bands[1]).toEqual({ start: 540, end: 600, top: 108, height: 28, days: {} });
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
      [480, 495, 7], [495, 500, 108], [500, 540, 40 / 60 * 28],
    ]);
    expect(bands[2].top).toBe(115);
  });

  it("does not expand carry-over cards when only another day's membership changes", () => {
    const long = ["a", "b", "c"].map((id) => shift(id, "07:00", "16:00"));
    const shorter = { ...shift("other-day", "07:00", "15:00"), start: localToISO("2026-11-07", "07:00"), end: localToISO("2026-11-07", "15:00") };
    const bands = buildTimelineBands([...long, shorter]);
    expect(bands.map(({ start, end, height }) => [start, end, height])).toEqual([
      [420, 900, 268], [900, 960, 28],
    ]);
    expect(bands[1].days["2026-11-06"]).toEqual(long);
    expect(bands[1].days["2026-11-07"]).toBeUndefined();
  });

  it("uses compact carry-over rows when one new shift joins four existing shifts", () => {
    const continuing = ["a", "b", "c", "d"].map((id) => shift(id, "07:00", "16:00"));
    const bands = buildTimelineBands([...continuing, shift("new", "08:00", "09:00")]);
    expect(bands[1]).toMatchObject({ start: 480, end: 540, height: 228 });
    expect(bands[1].days["2026-11-06"]).toHaveLength(5);
    expect(bands[2].height).toBe(196);
  });
});


describe("presentation shift summaries", () => {
  const assigned = (id: string, start: string, end: string, employeeId = "employee") => {
    const original = shift(id, start, end);
    original.assignments = [{ employeeId, start: original.start, end: original.end }];
    return original;
  };

  it("deduplicates identical assignments and retains all sources without mutating them", () => {
    const originals = [assigned("a", "07:00", "16:00"), assigned("b", "07:00", "16:00")];
    originals[0].note = "preserved only on source";
    const snapshot = structuredClone(originals);
    const result = summarizeTimelineShifts(originals);
    expect(result).toHaveLength(1);
    expect(result[0].shift.assignments).toHaveLength(1);
    expect(result[0].shift.required).toBe(1);
    expect(result[0].shift.note).toBeUndefined();
    expect(result[0].sources).toEqual(originals);
    expect(originals).toEqual(snapshot);
    expect(summarizeTimelineShifts([...originals].reverse())).toEqual(result);
  });

  it("unions overlapping and touching actual employee intervals", () => {
    const a = assigned("a", "07:00", "12:00");
    const b = assigned("b", "10:00", "16:00");
    const c = assigned("c", "16:00", "18:00");
    // The displayed union follows assignments rather than enclosing shift hours.
    a.assignments[0].start = localToISO("2026-11-06", "08:00");
    const result = summarizeTimelineShifts([a, b, c]);
    expect(result).toHaveLength(1);
    expect(Date.parse(result[0].shift.start)).toBe(Date.parse(a.assignments[0].start));
    expect(Date.parse(result[0].shift.end)).toBe(Date.parse(c.end));
    expect(result[0].sources).toEqual([a, b, c]);
  });

  it("keeps disjoint intervals and different groups separate", () => {
    const a = assigned("a", "07:00", "10:00");
    const b = assigned("b", "11:00", "16:00");
    const patrol = { ...a, id: "patrol", group: "PATROL" as const };
    const result = summarizeTimelineShifts([a, b, patrol]);
    expect(result).toHaveLength(3);
    expect(result.every((item) => item.sources.length === 1)).toBe(true);
  });

  it("groups different employees with identical union hours into one synthetic shift", () => {
    const a = assigned("a", "07:00", "16:00", "alice");
    const b = assigned("b", "07:00", "12:00", "bob");
    const c = assigned("c", "12:00", "16:00", "bob");
    const result = summarizeTimelineShifts([a, b, c]);
    expect(result).toHaveLength(1);
    expect(result[0].shift.assignments.map((item) => item.employeeId)).toEqual(["alice", "bob"]);
    expect(result[0].shift.required).toBe(2);
    expect(result[0].sources).toEqual([a, b, c]);
  });

  it("groups only exact unassigned intervals and keeps distinct durations", () => {
    const a = shift("a", "07:00", "16:00");
    const b = shift("b", "07:00", "16:00");
    const c = shift("c", "07:00", "15:00");
    const result = summarizeTimelineShifts([a, b, c]);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.sources.length).sort()).toEqual([1, 2]);
    expect(result.every((item) => item.shift.assignments.length === 0 && item.shift.required === 0)).toBe(true);
  });

  it("keeps overnight source dates separate even when employee intervals touch", () => {
    const a = shift("night", "22:00", "06:00", "2026-11-07");
    a.assignments = [{ employeeId: "employee", start: a.start, end: a.end }];
    const b = { ...assigned("morning", "06:00", "10:00"), start: localToISO("2026-11-07", "06:00"), end: localToISO("2026-11-07", "10:00") };
    b.assignments = [{ employeeId: "employee", start: b.start, end: b.end }];
    expect(summarizeTimelineShifts([a, b])).toHaveLength(2);
  });

  it("exposes the original day when an overnight assignment starts after midnight", () => {
    const night = shift("night", "22:00", "06:00", "2026-11-07");
    night.assignments = [{ employeeId: "late", start: localToISO("2026-11-07", "01:00"), end: night.end }];
    const [summary] = summarizeTimelineShifts([night]);
    expect(summary.date).toBe("2026-11-06");
    expect(Date.parse(summary.shift.start)).toBe(Date.parse(night.assignments[0].start));
  });
});
