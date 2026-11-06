import { describe, expect, it } from "vitest";
import { personalSchedule, personalShiftEndLabel } from "../src/lib/personal-schedule";
import { localToISO } from "../src/lib/time";
import type { Shift } from "../src/lib/types";

const employeeId = "personal-worker";
const now = new Date(localToISO("2030-08-04", "10:00"));
function shift(id: string, startDate: string, startClock: string, endDate: string, endClock: string): Shift {
  const start = localToISO(startDate, startClock), end = localToISO(endDate, endClock);
  return { id, title: id, start, end, group: "PATROL", required: 1, note: "private-management-note", assignments: [{ employeeId, start, end }] };
}
const published = (weekStart: string, shifts: Shift[]) => ({ weekStart, publications: [{ shifts }] });

describe("personal published schedule", () => {
  it("finds the next assignment in the following week and strips all private fields", () => {
    const future = shift("next-week", "2030-08-11", "22:00", "2030-08-12", "06:00");
    future.assignments.push({ ...future.assignments[0], employeeId: "another-worker" });
    const result = personalSchedule([
      published("2030-08-04", []),
      published("2030-08-11", [future]),
    ], employeeId, now);
    expect(result.currentWeekStatus).toBe("no-personal-assignment");
    expect(result.currentShift).toBeNull();
    expect(result.nextShift).toMatchObject({ shiftId: future.id, start: future.start, end: future.end });
    expect(result.upcomingShifts).toHaveLength(1);
    expect(result.availableThrough).toBe("2030-08-17");
    expect(personalShiftEndLabel(result.nextShift!)).toBe("הסיום ביום הבא");
    for (const secret of ["private-management-note", "another-worker", "assignments", "required", "employeeId", "locked"])
      expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("uses assignment times and recognizes a current night starting in the previous week", () => {
    const night = shift("saturday-night", "2030-08-03", "22:00", "2030-08-04", "12:00");
    night.assignments[0].end = localToISO("2030-08-04", "11:00");
    const result = personalSchedule([published("2030-07-28", [night])], employeeId, now);
    expect(result.currentShift?.shiftId).toBe(night.id);
    expect(result.currentShift?.end).toBe(night.assignments[0].end);
    expect(result.currentWeekStatus).toBe("unpublished");
    expect(result.nextShift).toBeNull();
  });

  it("ignores unpublished drafts and distinguishes published personal shifts that have ended", () => {
    const past = shift("past", "2030-08-04", "06:00", "2030-08-04", "08:00");
    const secret = shift("secret-draft", "2030-08-04", "12:00", "2030-08-04", "16:00");
    const unpublished = { weekStart: "2030-08-11", shifts: [secret], publications: [] };
    const result = personalSchedule([published("2030-08-04", [past]), unpublished], employeeId, now);
    expect(result.currentWeekStatus).toBe("assigned");
    expect(result.nextShift).toBeNull();
    expect(result.upcomingShifts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(secret.id);
    expect(personalSchedule([unpublished], employeeId, now).currentWeekStatus).toBe("unpublished");
    expect(personalSchedule([published("2030-08-04", [])], employeeId, now).currentWeekStatus).toBe("no-personal-assignment");
  });

  it("has no artificial week horizon and sorts across month and year boundaries", () => {
    const later = shift("later", "2031-01-01", "08:00", "2031-01-01", "12:00");
    const earlier = shift("earlier", "2030-08-31", "22:00", "2030-09-01", "06:00");
    const result = personalSchedule([published("2030-12-29", [later]), published("2030-08-25", [earlier])], employeeId, now);
    expect(result.upcomingShifts.map((item) => item.shiftId)).toEqual(["earlier", "later"]);
    expect(result.nextShift?.shiftId).toBe("earlier");
    expect(personalShiftEndLabel(earlier)).toBe("הסיום ביום הבא");
  });

  it("handles DST overnight by actual instants and treats ending now as ended", () => {
    const night = shift("dst-night", "2026-10-24", "22:00", "2026-10-25", "06:00");
    const weeks = [published("2026-10-18", [night])];
    const during = personalSchedule(weeks, employeeId, new Date(localToISO("2026-10-25", "03:00")));
    expect(during.currentShift?.shiftId).toBe(night.id);
    expect(personalShiftEndLabel(night)).toBe("הסיום ביום הבא");
    const ended = personalSchedule(weeks, employeeId, new Date(night.end));
    expect(ended.currentShift).toBeNull();
  });
});
