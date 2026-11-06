import { describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/reports/monthly/route";
import { requireUser } from "../src/lib/auth";
import { ApiError } from "../src/lib/validation";
import { getMonthlyReport, monthSchema, summarizeMonth } from "../src/lib/monthly-report";
import { localToISO } from "../src/lib/time";
import type { SessionUser, Shift } from "../src/lib/types";
import type { Tx } from "../src/lib/weeks";

vi.mock("../src/lib/db", () => ({ db: {} }));
vi.mock("../src/lib/auth", () => ({ requireUser: vi.fn() }));
const admin: SessionUser = { id: "admin", name: "מנהל", role: "ADMIN", employeeId: null };
const employee: SessionUser = { id: "user", name: "נועה", role: "EMPLOYEE", employeeId: "one" };
const now = new Date("2030-08-15T09:00:00Z");
function shift(id: string, startDate: string, startTime: string, endDate: string, endTime: string, employeeId = "one"): Shift {
  const start = localToISO(startDate, startTime);
  const end = localToISO(endDate, endTime);
  return { id, title: id, group: "PATROL", start, end, required: 1, assignments: [{ employeeId, start, end }], note: "private" };
}

describe("monthly published schedule aggregation", () => {
  it("splits hours at Jerusalem month boundaries and excludes midnight's following day", () => {
    const overnight = shift("boundary", "2030-07-31", "22:00", "2030-08-01", "02:00");
    const midnight = shift("midnight", "2030-08-02", "20:00", "2030-08-03", "00:00");
    const august = summarizeMonth([overnight, midnight], "one", "2030-08", now);
    expect(august.totals).toMatchObject({ hours: 6, shifts: 2, days: 2, elapsedHours: 6, remainingHours: 0 });
    expect(august.shifts.map((entry) => entry.days)).toEqual([["2030-08-01"], ["2030-08-02"]]);
    expect(summarizeMonth([overnight], "one", "2030-07", now).totals.hours).toBe(2);
  });

  it("uses assignment intervals rather than whole shift and counts unique days", () => {
    const long = shift("long", "2030-08-02", "08:00", "2030-08-02", "20:00");
    long.assignments[0].start = localToISO("2030-08-02", "10:00");
    long.assignments[0].end = localToISO("2030-08-02", "12:00");
    const second = shift("second", "2030-08-02", "14:00", "2030-08-02", "16:00");
    const other = shift("other", "2030-08-03", "10:00", "2030-08-03", "18:00", "two");
    expect(summarizeMonth([long, second, other], "one", "2030-08", now).totals).toMatchObject({ hours: 4, shifts: 2, days: 1 });
  });

  it("counts split assignments as one parent shift while retaining each interval", () => {
    const split = shift("split", "2030-08-15", "08:00", "2030-08-15", "16:00");
    split.assignments = [
      { employeeId: "one", start: localToISO("2030-08-15", "08:00"), end: localToISO("2030-08-15", "10:00") },
      { employeeId: "one", start: localToISO("2030-08-15", "14:00"), end: localToISO("2030-08-15", "16:00") },
    ];
    const report = summarizeMonth([split], "one", "2030-08", now);
    expect(report.totals).toMatchObject({ hours: 4, shifts: 1, days: 1, completedShifts: 0, ongoingShifts: 1, upcomingShifts: 0 });
    expect(report.shifts).toHaveLength(2);
    expect(new Set(report.shifts.map((entry) => entry.id)).size).toBe(2);
    expect(report.shifts.map((entry) => entry.shiftId)).toEqual(["split", "split"]);
    expect(summarizeMonth([split], "one", "2030-08", new Date("2030-08-14T00:00:00Z")).totals.upcomingShifts).toBe(1);
    expect(summarizeMonth([split], "one", "2030-08", new Date("2030-08-16T00:00:00Z")).totals.completedShifts).toBe(1);
  });

  it("uses actual durations across DST and lists every overnight date", () => {
    const fall = shift("fall", "2026-10-24", "22:00", "2026-10-25", "06:00");
    const spring = shift("spring", "2026-03-26", "22:00", "2026-03-27", "06:00");
    expect(summarizeMonth([fall], "one", "2026-10", now).totals.hours).toBe(9);
    expect(summarizeMonth([spring], "one", "2026-03", now).totals.hours).toBe(7);
    expect(summarizeMonth([fall], "one", "2026-10", now).shifts[0].days).toEqual(["2026-10-24", "2026-10-25"]);
  });

  it("separates completed, ongoing and future scheduled time", () => {
    const items = [
      shift("done", "2030-08-01", "08:00", "2030-08-01", "12:00"),
      shift("now", "2030-08-15", "10:00", "2030-08-15", "14:00"),
      shift("next", "2030-08-16", "10:00", "2030-08-16", "14:00"),
    ];
    expect(summarizeMonth(items, "one", "2030-08", now).totals).toEqual({
      hours: 12, shifts: 3, days: 3, elapsedHours: 6, remainingHours: 6,
      completedShifts: 1, ongoingShifts: 1, upcomingShifts: 1,
    });
  });

  it("handles year rollover and leap-day reporting", () => {
    const newYear = shift("year", "2029-12-31", "22:00", "2030-01-01", "02:00");
    expect(summarizeMonth([newYear], "one", "2030-01", now).totals.hours).toBe(2);
    const leapDay = shift("leap", "2028-02-29", "22:00", "2028-03-01", "02:00");
    expect(summarizeMonth([leapDay], "one", "2028-02", now).totals).toMatchObject({ hours: 2, days: 1 });
  });

  it("returns empty months and validates input without silent normalization", () => {
    expect(summarizeMonth([], "one", "2030-02", now).totals.hours).toBe(0);
    for (const month of ["2030-13", "2030-00", "2030-2", "bad", "2030-08-01"]) expect(monthSchema.safeParse(month).success).toBe(false);
  });
});

function fixture() {
  const august = shift("published", "2030-08-01", "08:00", "2030-08-01", "12:00");
  const july = shift("previous", "2030-07-31", "08:00", "2030-07-31", "14:00");
  const coworker = shift("coworker", "2030-08-01", "08:00", "2030-08-01", "16:00", "two");
  const draft = shift("secret-draft", "2030-08-02", "08:00", "2030-08-02", "16:00");
  const tx = {
    week: { findMany: vi.fn().mockResolvedValue([
      { shifts: [draft], publications: [{ shifts: [august, july, coworker] }] },
      { shifts: [draft], publications: [] },
    ]) },
    employee: { findMany: vi.fn().mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(
      [{ id: "one", name: "נועה", active: true }, { id: "two", name: "דן", active: false }].filter((row) => where.id === undefined || row.id === where.id),
    )) },
  };
  return { tx: tx as unknown as Tx, findEmployees: tx.employee.findMany, findWeeks: tx.week.findMany };
}

describe("monthly report authorization and source", () => {
  it("returns only the employee's row and published assignments with previous month totals", async () => {
    const { tx, findEmployees } = fixture();
    const report = await getMonthlyReport("2030-08", employee, tx, now);
    expect(findEmployees).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "one" } }));
    expect(report.employees).toHaveLength(1);
    expect(report.employees[0].totals.hours).toBe(4);
    expect(report.employees[0].previous.hours).toBe(6);
    expect(JSON.stringify(report)).not.toMatch(/coworker|secret-draft|private/);
    expect(report.source).toBe("published");
  });

  it("does not fall back to other employees when the account has no employee link", async () => {
    const { tx } = fixture();
    const report = await getMonthlyReport("2030-08", { ...employee, employeeId: null }, tx, now);
    expect(report.employees).toEqual([]);
  });

  it("includes inactive employees for admins and fetches preceding weeks for boundary crossings", async () => {
    const { tx, findEmployees, findWeeks } = fixture();
    const report = await getMonthlyReport("2030-08", admin, tx, now);
    expect(report.employees).toHaveLength(2);
    expect(report.employees[1]).toMatchObject({ id: "two", active: false, totals: { hours: 8 } });
    expect(findEmployees).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(findWeeks).toHaveBeenCalledWith(expect.objectContaining({ where: { weekStart: { gte: "2030-06-23", lt: "2030-09-01" } } }));
  });
});

describe("monthly route guards", () => {
  it("requires a valid session before querying reports", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new ApiError(401, "נדרשת התחברות"));
    const response = await GET(new Request("http://localhost/api/reports/monthly?month=2030-08"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects invalid months before database reads", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce(employee);
    const response = await GET(new Request("http://localhost/api/reports/monthly?month=2030-13"));
    expect(response.status).toBe(400);
  });
});
