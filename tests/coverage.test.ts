import { describe, expect, it } from "vitest";
import { coverageGaps, coverageSpans } from "../src/lib/coverage";
import { localToISO } from "../src/lib/time";
import type { Shift } from "../src/lib/types";
const at = (time: string, date = "2030-06-02") => localToISO(date, time);
const shift = (): Shift => ({ id: "gap", title: "סיור", group: "PATROL", start: at("15:00"), end: at("23:00"), required: 2,
  assignments: [{ employeeId: "a", start: at("15:00"), end: at("23:00") }, { employeeId: "b", start: at("15:00"), end: at("19:00") }] });
describe("interval staffing", () => {
  it("locates the precise missing person interval even with two names", () => {
    expect(coverageGaps(shift())).toEqual([{ start: new Date(at("19:00")).toISOString(), end: new Date(at("23:00")).toISOString(), missing: 1, message: "חסר סייר בין 19:00 ל־23:00" }]);
  });
  it("does not count duplicate employee assignments twice", () => {
    const s = shift(); s.assignments = [s.assignments[0], s.assignments[0]];
    expect(coverageSpans(s)[0].count).toBe(1);
    expect(coverageGaps(s)[0].missing).toBe(1);
  });
  it("merges adjacent gaps of equal shortage and labels overnight dates", () => {
    const s = shift(); s.end = at("06:00", "2030-06-03");
    s.assignments = [{ employeeId: "a", start: s.start, end: at("19:00") }, { employeeId: "b", start: at("19:00"), end: s.end }];
    expect(coverageGaps(s)).toHaveLength(1);
    expect(coverageGaps(s)[0].message).toContain("06:00 (2030-06-03)");
  });
});
