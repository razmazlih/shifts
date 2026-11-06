import { describe, expect, it } from "vitest";
import {
  addDays,
  localDate,
  localTime,
  localToISO,
  shiftByDays,
  weekDates,
  weekStart,
} from "../src/lib/time";
import type { Shift } from "../src/lib/types";

describe("Jerusalem civil time", () => {
  it("uses Sunday weeks across month and year boundaries", () => {
    expect(weekStart("2026-11-05")).toBe("2026-11-01");
    expect(weekStart("2027-01-01")).toBe("2026-12-27");
    expect(weekDates("2026-12-27")).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("round trips local input and requires an actual instant", () => {
    expect(localToISO("2026-11-05", "08:30")).toBe("2026-11-05T06:30:00Z");
    expect(localDate("2026-11-04T23:30:00Z")).toBe("2026-11-05");
    expect(localTime("2026-11-04T23:30:00Z")).toBe("01:30");
    expect(() => localDate("2026-11-05T08:30")).toThrow();
  });
  it("rejects nonexistent spring time unless a resolution is explicit", () => {
    expect(() => localToISO("2026-03-27", "02:30")).toThrow();
    expect(localTime(localToISO("2026-03-27", "02:30", "earlier"))).toBe(
      "01:30",
    );
    expect(localTime(localToISO("2026-03-27", "02:30", "later"))).toBe("03:30");
  });
  it("rejects repeated autumn time unless its occurrence is chosen", () => {
    expect(() => localToISO("2026-10-25", "01:30")).toThrow();
    const earlier = localToISO("2026-10-25", "01:30", "earlier");
    const later = localToISO("2026-10-25", "01:30", "later");
    expect(Date.parse(later) - Date.parse(earlier)).toBe(3_600_000);
  });
  it("copies civil times across DST instead of adding 24h multiples", () => {
    const start = localToISO("2026-03-20", "22:15:17");
    const end = localToISO("2026-03-21", "06:45:17");
    const shift: Shift = {
      id: "night",
      title: "night",
      group: "PATROL",
      required: 1,
      start,
      end,
      assignments: [{ employeeId: "a", start, end }],
    };
    const copy = shiftByDays(shift, 7);
    expect(copy.start).toBe(localToISO("2026-03-27", "22:15:17"));
    expect(copy.end).toBe(localToISO("2026-03-28", "06:45:17"));
    expect(Date.parse(copy.start) - Date.parse(start)).toBe(
      (7 * 24 - 1) * 3_600_000,
    );
    expect(copy.assignments[0]).not.toBe(shift.assignments[0]);
    expect(shift.start).toBe(start);
  });
  it("refuses to silently resolve ambiguous copied shifts", () => {
    const shift: Shift = {
      id: "x",
      title: "x",
      group: "PATROL",
      required: 1,
      start: localToISO("2026-10-18", "01:30"),
      end: localToISO("2026-10-18", "05:00"),
      assignments: [],
    };
    expect(() => shiftByDays(shift, 7)).toThrow();
  });
});
