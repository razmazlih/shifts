import { describe, expect, it, vi } from "vitest";
import type { SessionUser, Shift } from "../src/lib/types";
import { getWeekData, type Tx } from "../src/lib/weeks";
import { localToISO } from "../src/lib/time";
import { DEFAULT_RULES } from "../src/lib/scheduler";

vi.mock("../src/lib/db", () => ({ db: {} }));
const weekStart = "2030-08-04";
const admin: SessionUser = {
  id: "admin",
  name: "מנהל",
  role: "ADMIN",
  employeeId: null,
};
const worker: SessionUser = {
  id: "worker",
  name: "נועה",
  role: "EMPLOYEE",
  employeeId: "employee-one",
};
function shift(
  id: string,
  date: string,
  startClock: string,
  endDate: string,
  endClock: string,
): Shift {
  const start = localToISO(date, startClock),
    end = localToISO(endDate, endClock);
  return {
    id,
    title: id,
    group: "PATROL",
    start,
    end,
    required: 1,
    assignments: [{ employeeId: "employee-one", start, end }],
    note: `private-note-${id}`,
  };
}
function fixture(published = true) {
  const visibleShift = shift(
    "current-published",
    weekStart,
    "08:00",
    weekStart,
    "12:00",
  );
  const draft = shift(
    "current-secret-draft",
    weekStart,
    "09:00",
    weekStart,
    "13:00",
  );
  const previousPublished = shift(
    "previous-published",
    "2030-08-03",
    "22:00",
    weekStart,
    "06:00",
  );
  const previousDraft = shift(
    "previous-secret-draft",
    "2030-08-03",
    "10:00",
    "2030-08-03",
    "14:00",
  );
  const nextDraft = shift(
    "next-secret-draft",
    "2030-08-11",
    "08:00",
    "2030-08-11",
    "12:00",
  );
  const tx = {
    week: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          weekStart,
          revision: 5,
          shifts: [draft],
          publishedRevision: published ? 3 : null,
          publishedAt: published ? new Date("2030-08-01T08:00:00Z") : null,
          publications: published
            ? [{ revision: 3, shifts: [visibleShift] }]
            : [],
        }),
      findMany: vi.fn().mockResolvedValue([
        {
          weekStart: "2030-07-28",
          shifts: [previousDraft],
          publications: [{ revision: 2, shifts: [previousPublished] }],
        },
        { weekStart: "2030-08-11", shifts: [nextDraft], publications: [] },
      ]),
    },
    employee: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          {
            id: "employee-one",
            name: "נועה",
            email: "private-email@example.invalid",
            active: true,
            groups: ["PATROL"],
            maxWeeklyHours: 36,
            availability: [],
            timeOff: [
              {
                start: localToISO("2030-08-06", "08:00"),
                end: localToISO("2030-08-06", "17:00"),
                reason: "private-timeoff-reason",
              },
            ],
            preferredDays: [2],
          },
        ]),
    },
    settings: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ rules: { ...DEFAULT_RULES, minRestHours: 10 } }),
    },
  };
  return {
    tx,
    client: tx as unknown as Tx,
    visibleShift,
    draft,
    previousPublished,
    previousDraft,
    nextDraft,
  };
}

describe("role-sensitive week and adjacent-context projection", () => {
  it("returns authoritative neighboring context to admins and checks rest across Sunday boundaries", async () => {
    const f = fixture();
    const result = await getWeekData(weekStart, admin, undefined, f.client);
    expect(result.shifts).toEqual([f.draft]);
    expect(result).toHaveProperty("contextShifts", [
      f.previousPublished,
      f.nextDraft,
    ]);
    expect(JSON.stringify(result)).not.toContain(f.previousDraft.id);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REST",
          shiftId: f.draft.id,
          employeeId: "employee-one",
        }),
      ]),
    );
    expect(f.tx.week.findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: { weekStart: { in: ["2030-07-28", "2030-08-11"] } },
      }),
    );
    expect(result.employees[0].email).toBe("private-email@example.invalid");
  });

  it("never queries or exposes adjacent context to employees, even when draft is requested", async () => {
    const f = fixture();
    const result = await getWeekData(weekStart, worker, "draft", f.client);
    expect(f.tx.week.findMany).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("contextShifts");
    expect(result.shifts).toEqual([
      {
        id: f.visibleShift.id,
        title: f.visibleShift.title,
        group: f.visibleShift.group,
        start: f.visibleShift.start,
        end: f.visibleShift.end,
        required: f.visibleShift.required,
        assignments: f.visibleShift.assignments,
      },
    ]);
    expect(result).toMatchObject({
      revision: 3,
      publishedRevision: 3,
      hasDraft: false,
      issues: [],
      rules: DEFAULT_RULES,
    });
    expect(result.employees).toEqual([
      {
        id: "employee-one",
        name: "נועה",
        groups: ["PATROL"],
        active: true,
        maxWeeklyHours: 0,
        availability: [],
        timeOff: [],
        preferredDays: [],
      },
    ]);
    const serialized = JSON.stringify(result);
    for (const secret of [
      f.draft.id,
      f.previousDraft.id,
      f.nextDraft.id,
      f.previousPublished.id,
      "private-note-",
      "private-email",
      "private-timeoff-reason",
    ])
      expect(serialized).not.toContain(secret);
  });

  it("returns an empty schedule with no draft metadata when nothing has been published", async () => {
    const f = fixture(false);
    const result = await getWeekData(weekStart, worker, undefined, f.client);
    expect(result).toMatchObject({
      shifts: [],
      revision: 0,
      publishedRevision: null,
      publishedAt: null,
      hasDraft: false,
      issues: [],
    });
    expect(result).not.toHaveProperty("contextShifts");
    expect(f.tx.week.findMany).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret-draft");
  });
});

it("keeps assignment locks private in employee published responses", async () => {
  const f = fixture();
  f.visibleShift.assignments[0].locked = true;
  const result = await getWeekData(weekStart, worker, undefined, f.client);
  expect(result.shifts[0].assignments[0]).not.toHaveProperty("locked");
  expect(result.shifts[0].assignments[0].employeeId).toBe("employee-one");
});
