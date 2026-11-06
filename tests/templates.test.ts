import { describe, expect, it } from "vitest";
import { applyTemplateShifts, createTemplateEntries, createTemplateShifts, templateEntriesSchema, templateScope } from "../src/lib/templates";
import { localDate, localTime, localToISO } from "../src/lib/time";
import { templateToEntries } from "../src/lib/template-definitions";
import type { Shift } from "../src/lib/types";

const week = "2026-11-01";
const make = (date: string, id = date): Shift => ({
  id, title: "לילה", group: "PATROL", start: localToISO(date, "22:00"),
  end: localToISO(date === week ? "2026-11-02" : "2026-11-03", "06:00"),
  required: 2, note: "private", assignments: [{ employeeId: "employee", start: localToISO(date, "22:00"), end: localToISO(date === week ? "2026-11-02" : "2026-11-03", "06:00") }],
});

describe("day and week templates", () => {
  const entry = { title: "לילה", group: "PATROL" as const, startTime: "22:00", endTime: "06:00", required: 2, days: [0, 2, 6] };
  it("creates requirements directly on selected days, including Saturday overnight", () => {
    const shifts = createTemplateEntries([entry], week);
    expect(shifts.map((shift) => localDate(shift.start))).toEqual([week, "2026-11-03", "2026-11-07"]);
    expect(localDate(shifts[2].end)).toBe("2026-11-08");
    expect(shifts.every((shift) => shift.assignments.length === 0 && shift.required === 2)).toBe(true);
    expect(new Set(shifts.map((shift) => shift.id)).size).toBe(3);
  });
  it("treats equal clock times as a full-day requirement", () => {
    const [shift] = createTemplateEntries([{ ...entry, startTime: "08:00", endTime: "08:00", days: [0] }], week);
    expect(localDate(shift.end)).toBe("2026-11-02");
    expect(Date.parse(shift.end) - Date.parse(shift.start)).toBe(24 * 3600000);
  });
  it("rejects missing or duplicate days, invalid times, and excessive expanded requirements", () => {
    for (const entries of [[], [{ ...entry, days: [] }], [{ ...entry, days: [0, 0] }], [{ ...entry, startTime: "25:00" }],
      Array.from({ length: 43 }, () => ({ ...entry, days: [0, 1, 2, 3, 4, 5, 6] }))])
      expect(templateEntriesSchema.safeParse(entries).success).toBe(false);
  });
  it("rejects requirements whose local times land in a daylight-saving gap", () => {
    expect(() => createTemplateEntries([{ ...entry, startTime: "02:30", endTime: "06:00", days: [5] }], "2026-03-22"))
      .toThrow("מעבר שעון");
  });
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


describe("template editing compatibility", () => {
  it("round trips repeated requirements including duplicate same-day rows and 48-hour spans", () => {
    const shifts = createTemplateEntries([
      { title: "רצף", group: "PATROL", startTime: "08:00", endTime: "08:00", endDayOffset: 2, required: 2, days: [0, 2] },
      { title: "רצף", group: "PATROL", startTime: "08:00", endTime: "08:00", endDayOffset: 2, required: 2, days: [0] },
    ], week);
    const entries = templateToEntries({ sourceWeek: week, shifts });
    expect(entries).toHaveLength(2);
    expect(entries[0].days).toEqual([0, 2]);
    expect(entries[1].days).toEqual([0]);
    const normalized = (items: Shift[]) => items.map(shift => ({ title: shift.title, group: shift.group, start: shift.start, end: shift.end, required: shift.required })).sort((a, b) => a.start.localeCompare(b.start));
    expect(normalized(createTemplateEntries(entries, week))).toEqual(normalized(shifts));
    expect(shifts.every(shift => Date.parse(shift.end) - Date.parse(shift.start) === 48 * 3600000)).toBe(true);
  });
  it("preserves legacy overnight inference and rejects negative or excessive explicit duration", () => {
    const base = { title: "לילה", group: "PATROL", startTime: "22:00", endTime: "06:00", required: 1, days: [0] };
    expect(localDate(createTemplateEntries([base], week)[0].end)).toBe("2026-11-02");
    expect(templateEntriesSchema.safeParse([{ ...base, endDayOffset: 0 }]).success).toBe(false);
    expect(templateEntriesSchema.safeParse([{ ...base, startTime: "06:00", endTime: "08:00", endDayOffset: 2 }]).success).toBe(false);
  });
});
