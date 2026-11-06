import { describe, expect, it } from "vitest";
import { explainProposalIssues, proposalSummary, scopedTemplateShifts, schedulingFingerprint, verifyProposalChanges } from "../src/lib/schedule-proposals";
import { localToISO } from "../src/lib/time";
import { DEFAULT_RULES, validateSchedule } from "../src/lib/scheduler";
import type { Employee, SchedulingScope, Shift } from "../src/lib/types";
const scope: SchedulingScope = { days: [0], groups: ["PATROL"] };
const start = localToISO("2030-06-02", "08:00"), end = localToISO("2030-06-02", "16:00");
const shift: Shift = { id: "shift", title: "בדיקה", group: "PATROL", start, end, required: 2, assignments: [{ employeeId: "one", start, end, locked: true }] };
const employee: Employee = { id: "one", name: "עובד בדיקה", active: true, groups: ["PATROL"], maxWeeklyHours: 40, availability: [], timeOff: [], preferredDays: [] };

describe("proposal invariants", () => {
  it("accepts unchanged records after JSONB and schema parsing reorder object properties", () => {
    const reordered = {
      assignments: [{ end, locked: true, employeeId: "one", start }],
      required: shift.required, end, start, group: shift.group, title: shift.title, id: shift.id,
    };
    expect(() => verifyProposalChanges([shift], [reordered], "fill", scope)).not.toThrow();
    expect(() => verifyProposalChanges([shift], [reordered], "repair", { days: [1], groups: ["MANAGERS"] })).not.toThrow();
    expect(proposalSummary([shift], [reordered], []).summary).toMatchObject({ changedAssignments: 0, unchangedAssignments: 1 });
    expect(proposalSummary([shift], [reordered], []).changes).toEqual([]);
  });
  it("forbids moving a locked assignment even during repair", () => {
    const after = structuredClone(shift); after.assignments[0].end = localToISO("2030-06-02", "15:00");
    expect(() => verifyProposalChanges([shift], [after], "repair", scope)).toThrow("נעול");
  });
  it("forbids removal of unlocked work during fill and any edits outside scope", () => {
    const unlocked = { ...shift, assignments: shift.assignments.map((a) => ({ ...a, locked: false })) };
    expect(() => verifyProposalChanges([unlocked], [{ ...unlocked, assignments: [] }], "fill", scope)).toThrow("השלמת חוסרים");
    const other = { ...unlocked, id: "other", group: "MANAGERS" as const };
    expect(() => verifyProposalChanges([other], [{ ...other, assignments: [] }], "repair", scope)).toThrow("תחום הפעולה");
  });
  it("permits additions, reports exact differences and counts retained work", () => {
    const after = { ...shift, assignments: [...shift.assignments, { employeeId: "two", start, end }] };
    expect(() => verifyProposalChanges([shift], [after], "fill", scope)).not.toThrow();
    expect(proposalSummary([shift], [after], []).summary).toEqual({ addedAssignments: 1, changedAssignments: 0, unchangedAssignments: 1, unfilledShifts: 0 });
  });
  it("fingerprints availability, rules and neighboring commitments independent of row order", () => {
    const second = { ...employee, id: "two" };
    const baseline = schedulingFingerprint([shift], [employee, second], DEFAULT_RULES, []);
    expect(schedulingFingerprint([shift], [second, employee], DEFAULT_RULES, [])).toBe(baseline);
    expect(schedulingFingerprint([shift], [{ ...employee, timeOff: [{ start, end }] }, second], DEFAULT_RULES, [])).not.toBe(baseline);
    expect(schedulingFingerprint([shift], [employee, second], { ...DEFAULT_RULES, minRestHours: 10 }, [])).not.toBe(baseline);
    expect(schedulingFingerprint([shift], [employee, second], DEFAULT_RULES, [{ ...shift, id: "neighbor" }])).not.toBe(baseline);
  });
  it("daily template affects only requested day/team and never replaces locks", () => {
    const other = { ...shift, group: "MANAGERS" as const };
    const template = { shifts: [shift, other], sourceWeek: "2030-06-02" };
    const result = scopedTemplateShifts([other], template, { weekStart: "2030-06-02", mode: "fill", scope });
    expect(result[0]).toEqual(other);
    expect(result).toHaveLength(2);
    expect(result[1].group).toBe("PATROL");
    expect(result[1].assignments).toEqual([]);
    expect(() => scopedTemplateShifts([shift], template, { weekStart: "2030-06-02", mode: "repair", scope })).toThrow("נעול");
  });
});

describe("preview gap explanations", () => {
  const empty = { ...shift, required: 1, assignments: [] };
  const explain = (shifts: Shift[], people: Employee[], selected = scope) => explainProposalIssues(
    validateSchedule(shifts, people, DEFAULT_RULES), shifts, people, DEFAULT_RULES, [], selected,
  ).filter(issue => issue.code === "UNDERSTAFFED");
  it("explains that days or teams outside the selected scope were not changed", () => {
    expect(explain([empty], [employee], { days: [1], groups: ["PATROL"] })[0].message).toContain("מחוץ לימים או לצוותים שנבחרו");
  });
  it("attaches actual absence and other-commitment reasons to the exact gap", () => {
    const unavailable = { ...employee, timeOff: [{ start, end }] };
    const otherWork = { ...shift, id: "other", required: 1 };
    const message = explain([empty, otherWork], [unavailable])[0].message;
    expect(message).toContain("חסר סייר בין 08:00 ל־16:00");
    expect(message).toContain("היעדרות");
    expect(message).toContain("חופפים");
  });
  it("reports an empty workforce without claiming schedule correctness", () => {
    expect(explain([empty], [])[0].message).toContain("אין נתוני עובדים פעילים");
  });
  it("does not invent a rest conflict when a candidate can extend their original partial assignment", () => {
    const partial = { ...empty, assignments: [{ employeeId: employee.id, start, end: localToISO("2030-06-02", "12:00") }] };
    const before = structuredClone(partial);
    const message = explain([partial], [employee])[0].message;
    expect(message).toContain("נמצאו 1 מועמדים");
    expect(message).toContain("אין הבטחה לפתרון מיטבי");
    expect(partial).toEqual(before);
  });
});
