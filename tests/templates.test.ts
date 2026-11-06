import { describe, expect, it } from "vitest";
import { applyTemplateShifts, createTemplateShifts, templateScope } from "../src/lib/templates";
import { localDate, localTime, localToISO } from "../src/lib/time";
import type { Shift } from "../src/lib/types";

const week = "2026-11-01";
const make = (date: string, id = date): Shift => ({
  id, title: "לילה", group: "PATROL", start: localToISO(date, "22:00"),
  end: localToISO(date === week ? "2026-11-02" : "2026-11-03", "06:00"),
  required: 2, note: "private", assignments: [{ employeeId: "employee", start: localToISO(date, "22:00"), end: localToISO(date === week ? "2026-11-02" : "2026-11-03", "06:00") }],
});

describe("day and week templates", () => {
  it("selects by local start day and removes personal information", () => {
    const shifts = createTemplateShifts([make(week), make("2026-11-02")], week, 0);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].assignments).toEqual([]);
    expect(shifts[0].note).toBeUndefined();
    expect(templateScope(shifts)).toBe("day");
  });
  it("creates a seven-day template preserving overnight wall times with unique IDs", () => {
    const shifts = createTemplateShifts([make(week)], week, 0, true);
    expect(shifts).toHaveLength(7);
    expect(new Set(shifts.map((s) => s.id)).size).toBe(7);
    expect(new Set(shifts.map((s) => localDate(s.start))).size).toBe(7);
    expect(shifts.every((s) => localTime(s.start) === "22:00" && localTime(s.end) === "06:00")).toBe(true);
    expect(localDate(shifts[6].end)).toBe("2026-11-08");
    expect(templateScope(shifts)).toBe("week");
  });
  it("replaces only the target day and preserves other days and assignments", () => {
    const current = [make(week), make("2026-11-02")];
    const result = applyTemplateShifts(current, { shifts: [make(week)], sourceWeek: week }, week, 1);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(current[0]);
    expect(localDate(result[1].start)).toBe("2026-11-02");
    expect(localDate(result[1].end)).toBe("2026-11-03");
    expect(result[1].id).not.toBe(current[1].id);
    expect(result[1].assignments).toEqual([]);
  });
  it("applies a daily template to the full destination week", () => {
    const result = applyTemplateShifts([make(week)], { shifts: [make(week)], sourceWeek: week }, "2026-11-08", undefined, true);
    expect(result).toHaveLength(7);
    expect(localDate(result[0].start)).toBe("2026-11-08");
    expect(localDate(result[6].start)).toBe("2026-11-14");
  });
  it("rejects empty source days, ambiguous targets and oversized weeks", () => {
    expect(() => createTemplateShifts([make(week)], week, 2)).toThrow("אין משמרות");
    expect(() => createTemplateShifts([make(week)], week, undefined, true)).toThrow("יום מקור");
    const template = { shifts: [make(week)], sourceWeek: week };
    expect(applyTemplateShifts([], template, "2026-11-08")).toHaveLength(1);
    expect(() => applyTemplateShifts([], template, week, 1, true)).toThrow("יום יעד או");
    expect(() => createTemplateShifts(Array.from({length: 43}, (_, i) => make(week, `shift-${i}`)), week, 0, true)).toThrow("300");
  });
  it("copies weekly templates while retaining relative weekdays", () => {
    const result = applyTemplateShifts([], { shifts: [make(week), make("2026-11-02")], sourceWeek: week }, "2026-11-08");
    expect(result.map((s) => localDate(s.start))).toEqual(["2026-11-08", "2026-11-09"]);
    expect(result.every((s) => s.assignments.length === 0 && !s.note)).toBe(true);
  });
});
