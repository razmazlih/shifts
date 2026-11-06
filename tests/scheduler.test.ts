import { describe, expect, it } from "vitest";
import {
  autoSchedule,
  DEFAULT_RULES,
  getCandidates,
  validateSchedule,
} from "../src/lib/scheduler";
import { localToISO } from "../src/lib/time";
import type { Employee, Rules, Shift } from "../src/lib/types";
const employee = (id: string, patch: Partial<Employee> = {}): Employee => ({
  id,
  name: id,
  active: true,
  groups: ["PATROL"],
  maxWeeklyHours: 42,
  availability: [],
  timeOff: [],
  preferredDays: [],
  ...patch,
});
const at = (date: string, time: string) => localToISO(date, time);
const shift = (
  id: string,
  date = "2026-11-01",
  start = "08:00",
  end = "16:00",
  ids: string[] = [],
  endDate = date,
): Shift => {
  const s = at(date, start),
    e = at(endDate, end);
  return {
    id,
    title: id,
    start: s,
    end: e,
    group: "PATROL",
    required: 1,
    assignments: ids.map((employeeId) => ({ employeeId, start: s, end: e })),
  };
};
const codes = (
  shifts: Shift[],
  people = [employee("a")],
  rules: Rules = DEFAULT_RULES,
  context: Shift[] = [],
) => validateSchedule(shifts, people, rules, context).map((i) => i.code);

describe("schedule validation", () => {
  it("treats gaps as warnings and interval overcoverage as errors", () => {
    const s = shift("s");
    s.required = 2;
    s.assignments = [
      { employeeId: "a", start: s.start, end: s.end },
      { employeeId: "b", start: s.start, end: at("2026-11-01", "12:00") },
      { employeeId: "c", start: at("2026-11-01", "12:00"), end: s.end },
    ];
    const people = ["a", "b", "c"].map((id) => employee(id));
    expect(validateSchedule([s], people, DEFAULT_RULES)).toEqual([]);
    s.assignments[2].start = at("2026-11-01", "13:00");
    expect(validateSchedule([s], people, DEFAULT_RULES)).toEqual([
      expect.objectContaining({ code: "UNDERSTAFFED", severity: "warning" }),
    ]);
    s.assignments[2].start = at("2026-11-01", "11:00");
    expect(codes([s], people)).toContain("OVERSTAFFED");
  });
  it("enforces actual availability and supports overnight windows from the preceding day", () => {
    const night = shift(
      "night",
      "2026-11-01",
      "22:00",
      "06:00",
      ["a"],
      "2026-11-02",
    );
    const person = employee("a", {
      availability: [{ day: 0, start: "22:00", end: "06:00" }],
    });
    expect(codes([night], [person])).toEqual([]);
    expect(
      codes([shift("early", "2026-11-02", "01:00", "05:00", ["a"])], [person]),
    ).toEqual([]);
    person.availability[0].end = "05:00";
    expect(codes([night], [person])).toContain("UNAVAILABLE");
  });
  it("unions adjacent availability windows but rejects actual gaps", () => {
    const s = shift("s", "2026-11-01", "08:00", "16:00", ["a"]);
    const person = employee("a", {
      availability: [
        { day: 0, start: "08:00", end: "12:00" },
        { day: 0, start: "12:00", end: "16:00" },
      ],
    });
    expect(codes([s], [person])).toEqual([]);
    person.availability[1].start = "12:01";
    expect(codes([s], [person])).toContain("UNAVAILABLE");
  });
  it("rejects inactive, wrong-group, unknown, absent, outside and malformed assignments", () => {
    const s = shift("s", "2026-11-01", "08:00", "16:00", ["a"]);
    expect(
      codes(
        [s],
        [
          employee("a", {
            active: false,
            groups: ["MANAGERS"],
            timeOff: [{ start: s.start, end: s.end }],
          }),
        ],
      ),
    ).toEqual(expect.arrayContaining(["INACTIVE", "GROUP", "TIME_OFF"]));
    expect(codes([s], [])).toContain("UNKNOWN_EMPLOYEE");
    s.assignments[0].start = at("2026-11-01", "07:00");
    expect(codes([s])).toContain("OUTSIDE_SHIFT");
    s.assignments[0].end = "broken";
    expect(codes([s])).toContain("INVALID_ASSIGNMENT_TIME");
    s.start = s.end;
    expect(codes([s])).toContain("INVALID_TIME");
  });
  it("uses neighboring-week context for rest and deduplicates target shifts", () => {
    const previous = shift("previous", "2026-10-31", "17:00", "23:00", ["a"]);
    const current = shift("current", "2026-11-01", "05:00", "13:00", ["a"]);
    expect(
      codes([current], [employee("a")], DEFAULT_RULES, [previous, current]),
    ).toEqual(["REST"]);
    current.start = at("2026-11-01", "07:00");
    current.assignments[0].start = current.start;
    expect(
      codes([current], [employee("a")], DEFAULT_RULES, [previous, current]),
    ).toEqual([]);
  });
  it("splits actual hours at Sunday midnight, with per-employee limits", () => {
    const cross = shift(
      "cross",
      "2026-10-31",
      "22:00",
      "06:00",
      ["a"],
      "2026-11-01",
    );
    const current = shift("current", "2026-11-02", "08:00", "16:00", ["a"]);
    expect(
      codes([current], [employee("a", { maxWeeklyHours: 14 })], DEFAULT_RULES, [
        cross,
      ]),
    ).toEqual([]);
    expect(
      codes([current], [employee("a", { maxWeeklyHours: 13 })], DEFAULT_RULES, [
        cross,
      ]),
    ).toContain("WEEKLY_HOURS");
    expect(codes([cross], [employee("a", { maxWeeklyHours: 6 })])).toEqual([]);
  });
  it("counts elapsed DST hours rather than clock-face subtraction", () => {
    const spring = shift("spring", "2026-03-27", "00:00", "08:00", ["a"]);
    const fall = shift("fall", "2026-10-25", "00:00", "08:00", ["a"]);
    expect(codes([spring], [employee("a", { maxWeeklyHours: 7 })])).toEqual([]);
    expect(codes([fall], [employee("a", { maxWeeklyHours: 8 })])).toContain(
      "WEEKLY_HOURS",
    );
  });
  it("detects overlap in split assignments and checks duration limits", () => {
    const s = shift("s", "2026-11-01", "08:00", "16:00", ["a"]);
    s.required = 2;
    s.assignments.push({ ...s.assignments[0] });
    expect(codes([s])).toContain("OVERLAP");
    expect(
      codes([shift("long", "2026-11-01", "01:00", "16:00", ["a"])]),
    ).toContain("ASSIGNMENT_TOO_LONG");
  });
});

describe("automatic scheduling and candidates", () => {
  it("balances hours fairly and deterministically without mutating input", () => {
    const shifts = Array.from({ length: 4 }, (_, i) =>
      shift(`s${i}`, `2026-11-0${i + 1}`),
    );
    const before = JSON.stringify(shifts);
    const employees = ["a", "b"].map((id) => employee(id));
    const result = autoSchedule(shifts, employees, DEFAULT_RULES);
    expect(result.issues).toEqual([]);
    expect(result.shifts.map((s) => s.assignments[0].employeeId)).toEqual([
      "a",
      "b",
      "a",
      "b",
    ]);
    expect(JSON.stringify(shifts)).toBe(before);
    expect(
      autoSchedule(shifts, [...employees].reverse(), DEFAULT_RULES),
    ).toEqual(result);
  });
  it("fills partial multi-worker coverage while respecting existing segments", () => {
    const s = shift("s", "2026-11-01", "08:00", "16:00", ["a"]);
    s.required = 2;
    s.assignments[0].end = at("2026-11-01", "12:00");
    const result = autoSchedule(
      [s],
      ["a", "b"].map((id) => employee(id)),
      DEFAULT_RULES,
    );
    expect(result.issues).toEqual([]);
    expect(result.shifts[0].assignments).toHaveLength(3);
    expect(result.shifts[0].assignments[0]).toEqual(s.assignments[0]);
    expect(result.shifts[0].assignments).toContainEqual({ employeeId: "a", start: at("2026-11-01", "12:00"), end: s.end });
  });
  it("never adds ineligible workers and explains unfilled positions", () => {
    const s = shift("s");
    const people = [
      employee("off", { timeOff: [{ start: s.start, end: s.end }] }),
      employee("inactive", { active: false }),
      employee("wrong", { groups: ["MANAGERS"] }),
    ];
    const result = autoSchedule([s], people, DEFAULT_RULES);
    expect(result.shifts[0].assignments).toEqual([]);
    expect(result.issues.map((i) => i.code)).toEqual([
      "UNDERSTAFFED",
      "UNFILLED_REASON",
    ]);
    expect(result.issues[1].message).toContain("היעדרות");
    expect(
      getCandidates(s, [s], people, DEFAULT_RULES).every(
        (c) => !c.eligible && c.reasons.length,
      ),
    ).toBe(true);
  });
  it("shows current actual hours and eligibility including adjacent weeks", () => {
    const previous = shift(
      "prior",
      "2026-10-31",
      "22:00",
      "06:00",
      ["a"],
      "2026-11-01",
    );
    const s = shift("s", "2026-11-01", "10:00", "18:00");
    const candidate = getCandidates(s, [s], [employee("a")], DEFAULT_RULES, [
      previous,
    ])[0];
    expect(candidate.hours).toBe(6);
    expect(candidate.eligible).toBe(false);
    expect(candidate.reasons).toContain("אין מספיק שעות מנוחה בין השיבוצים");
  });
  it("honors weekly caps and leaves valid incomplete schedules", () => {
    const result = autoSchedule(
      [shift("one"), shift("two", "2026-11-02")],
      [employee("a", { maxWeeklyHours: 8 })],
      DEFAULT_RULES,
    );
    expect(result.shifts.map((s) => s.assignments.length)).toEqual([1, 0]);
    expect(result.issues.every((i) => i.severity === "warning")).toBe(true);
  });
});

describe("continuous work and longer operations", () => {
  it("accepts multiple touching pieces as one assignment, with no artificial rest conflicts", () => {
    const s = shift("s", "2026-11-01", "08:00", "16:00");
    s.assignments = ["08:00", "10:00", "12:00", "14:00"].map((start, i) => ({
      employeeId: "a",
      start: at("2026-11-01", start),
      end: at("2026-11-01", ["10:00", "12:00", "14:00", "16:00"][i]),
    }));
    expect(codes([s])).toEqual([]);
    expect(
      codes([s], [employee("a")], { ...DEFAULT_RULES, maxShiftHours: 6 }),
    ).toContain("ASSIGNMENT_TOO_LONG");
  });
  it("fills 24h operations with legal individual durations", () => {
    const s = shift("s", "2026-11-01", "00:00", "00:00", [], "2026-11-02");
    const result = autoSchedule(
      [s],
      ["a", "b", "c"].map((id) => employee(id)),
      { ...DEFAULT_RULES, maxShiftHours: 8 },
    );
    expect(result.issues).toEqual([]);
    expect(result.shifts[0].assignments).toHaveLength(3);
  });
  it("splits work at availability boundaries", () => {
    const people = [
      employee("a", {
        availability: [{ day: 0, start: "08:00", end: "12:00" }],
      }),
      employee("b", {
        availability: [{ day: 0, start: "12:00", end: "16:00" }],
      }),
    ];
    const result = autoSchedule([shift("s")], people, DEFAULT_RULES);
    expect(result.issues).toEqual([]);
    expect(result.shifts[0].assignments.map((a) => a.employeeId)).toEqual([
      "a",
      "b",
    ]);
  });
  it("replaces malformed existing assignments without crashing automatic scheduling", () => {
    const s = shift("s", "2026-11-01", "08:00", "16:00", ["a"]);
    s.assignments[0].start = "invalid";
    const result = autoSchedule([s], [employee("a")], DEFAULT_RULES, [], { mode: "repair" });
    expect(result.issues).toEqual([]);
    expect(result.shifts[0].assignments).toEqual([{ employeeId: "a", start: s.start, end: s.end }]);
  });
});

describe("DST recurring availability", () => {
  it("does not invent available time before a nonexistent start boundary", () => {
    const person = employee("a", {
      availability: [{ day: 5, start: "02:30", end: "04:00" }],
    });
    expect(
      codes([shift("early", "2026-03-27", "01:30", "01:45", ["a"])], [person]),
    ).toContain("UNAVAILABLE");
    expect(
      codes([shift("after", "2026-03-27", "03:00", "04:00", ["a"])], [person]),
    ).toEqual([]);
  });
  it("does not extend a nonexistent end boundary after the gap", () => {
    const person = employee("a", {
      availability: [{ day: 5, start: "00:00", end: "02:30" }],
    });
    expect(
      codes([shift("before", "2026-03-27", "01:30", "03:00", ["a"])], [person]),
    ).toEqual([]);
    expect(
      codes([shift("after", "2026-03-27", "03:00", "03:15", ["a"])], [person]),
    ).toContain("UNAVAILABLE");
  });
  it("includes both occurrences of a repeated available time", () => {
    const person = employee("a", {
      availability: [{ day: 0, start: "01:00", end: "02:00" }],
    });
    const s: Shift = {
      id: "fold",
      title: "fold",
      required: 1,
      group: "PATROL",
      start: localToISO("2026-10-25", "01:15", "earlier"),
      end: localToISO("2026-10-25", "01:45", "later"),
      assignments: [],
    };
    s.assignments = [{ employeeId: "a", start: s.start, end: s.end }];
    expect(codes([s], [person])).toEqual([]);
  });
});

it("cannot bypass the continuous-work cap by adjoining separate shifts when minimum rest is zero", () => {
  const shifts = [
    shift("one", "2026-11-01", "00:00", "08:00", ["a"]),
    shift("two", "2026-11-01", "08:00", "16:00", ["a"]),
  ];
  expect(
    codes(shifts, [employee("a")], { ...DEFAULT_RULES, minRestHours: 0 }),
  ).toEqual(["ASSIGNMENT_TOO_LONG", "ASSIGNMENT_TOO_LONG"]);
});

const repair = (...args: Parameters<typeof autoSchedule>) => autoSchedule(args[0], args[1], args[2], args[3], { mode: "repair" });

describe("automatic conflict repair", () => {
  it("repairs overlaps deterministically and preserves unrelated work and metadata", () => {
    const early = shift("early", "2026-11-01", "08:00", "16:00", ["a"]);
    const overlapping = shift("overlapping", "2026-11-01", "12:00", "20:00", ["a"]);
    const untouched = { ...shift("untouched", "2026-11-03", "08:00", "16:00", ["c"]), note: "keep me" };
    const input = [overlapping, untouched, early];
    const before = structuredClone(input);
    const people = ["a", "b", "c"].map((id) => employee(id));
    const result = repair(input, people, DEFAULT_RULES);
    expect(result.issues).toEqual([]);
    expect(result.shifts.find((s) => s.id === "early")).toEqual(early);
    expect(result.shifts.find((s) => s.id === "untouched")).toEqual(untouched);
    expect(result.shifts.find((s) => s.id === "overlapping")?.assignments[0].employeeId).toBe("b");
    expect(input).toEqual(before);
    expect(repair(input, [...people].reverse(), DEFAULT_RULES)).toEqual(result);
    expect(repair(result.shifts, people, DEFAULT_RULES)).toEqual(result);
  });

  it("repairs rest conflicts without displacing valid work or changing neighboring context", () => {
    const context = [shift("previous", "2026-10-31", "22:00", "06:00", ["a"], "2026-11-01")];
    const current = shift("current", "2026-11-01", "10:00", "18:00", ["a"]);
    const next = shift("next", "2026-11-02", "10:00", "18:00", ["b"]);
    const before = structuredClone(context);
    const result = repair([current, next], [employee("a"), employee("b", { maxWeeklyHours: 8 }), employee("c")], DEFAULT_RULES, context);
    expect(result.issues).toEqual([]);
    expect(result.shifts[0].assignments[0].employeeId).toBe("c");
    expect(result.shifts[1].assignments[0].employeeId).toBe("b");
    expect(context).toEqual(before);
  });

  it("repairs weekly excess while retaining earlier assignments", () => {
    const first = shift("first", "2026-11-01", "08:00", "16:00", ["a"]);
    const later = shift("later", "2026-11-02", "08:00", "16:00", ["a"]);
    const result = repair([later, first], [employee("a", { maxWeeklyHours: 8 }), employee("b")], DEFAULT_RULES);
    expect(result.issues).toEqual([]);
    expect(result.shifts.find((s) => s.id === "first")).toEqual(first);
    expect(result.shifts.find((s) => s.id === "later")?.assignments[0].employeeId).toBe("b");
  });

  it("removes unsuitable existing workers and reports a shortage when no replacement exists", () => {
    const s = shift("s", "2026-11-01", "08:00", "16:00", ["missing", "inactive", "wrong", "off", "unavailable"]);
    s.required = 5;
    const people = [employee("inactive", { active: false }), employee("wrong", { groups: ["MANAGERS"] }), employee("off", { timeOff: [{ start: s.start, end: s.end }] }), employee("unavailable", { availability: [{ day: 1, start: "08:00", end: "16:00" }] })];
    const result = repair([s], people, DEFAULT_RULES);
    expect(result.shifts[0].assignments).toEqual([]);
    expect(result.issues.map((i) => i.code)).toEqual(["UNDERSTAFFED", "UNFILLED_REASON"]);
  });

  it("clips assignments to shift bounds and trims only excess partial coverage", () => {
    const s = shift("s", "2026-11-01", "08:00", "16:00");
    s.assignments = [
      { employeeId: "a", start: at("2026-11-01", "07:00"), end: at("2026-11-01", "12:00") },
      { employeeId: "b", start: at("2026-11-01", "10:00"), end: at("2026-11-01", "17:00") },
    ];
    const result = repair([s], [employee("a"), employee("b")], DEFAULT_RULES);
    expect(result.issues).toEqual([]);
    expect(result.shifts[0].assignments).toEqual([
      { employeeId: "a", start: s.start, end: at("2026-11-01", "12:00") },
      { employeeId: "b", start: at("2026-11-01", "12:00"), end: s.end },
    ]);
  });

  it("keeps structural problems visible instead of changing shift requirements or times", () => {
    const invalid = { ...shift("invalid"), required: 0 };
    const result = repair([invalid], [employee("a")], DEFAULT_RULES);
    expect(result.shifts).toEqual([invalid]);
    expect(result.issues.map((i) => i.code)).toContain("INVALID_REQUIRED");
  });
});

describe("safe scoped automation", () => {
  it("preserves even invalid existing assignments in default fill mode", () => {
    const early = shift("early", "2026-11-01", "08:00", "16:00", ["a"]);
    const overlap = shift("overlap", "2026-11-01", "12:00", "20:00", ["a"]);
    const result = autoSchedule([early, overlap], [employee("a"), employee("b")], DEFAULT_RULES);
    expect(result.shifts).toEqual([early, overlap]);
    expect(result.issues.map((issue) => issue.code)).toContain("OVERLAP");
  });
  it("modifies only the selected day and team while validating other commitments", () => {
    const otherTeam = { ...shift("manager", "2026-11-01", "08:00", "16:00", ["a"]), group: "MANAGERS" as const };
    const selected = shift("patrol", "2026-11-01", "10:00", "18:00");
    const otherDay = shift("monday", "2026-11-02");
    const result = autoSchedule([otherTeam, selected, otherDay], [employee("a", { groups: ["MANAGERS", "PATROL"] }), employee("b")], DEFAULT_RULES, [], {
      scope: { days: [0], groups: ["PATROL"] },
    });
    expect(result.shifts[0]).toEqual(otherTeam);
    expect(result.shifts[2]).toEqual(otherDay);
    expect(result.shifts[1].assignments[0].employeeId).toBe("b");
  });
  it("keeps locked work verbatim during repair even when it violates availability", () => {
    const s = shift("locked", "2026-11-01", "08:00", "16:00", ["a"]);
    s.assignments[0].locked = true;
    const result = autoSchedule([s], [employee("a", { timeOff: [{ start: s.start, end: s.end }] }), employee("b")], DEFAULT_RULES, [], { mode: "repair" });
    expect(result.shifts[0]).toEqual(s);
    expect(result.issues.map((issue) => issue.code)).toContain("TIME_OFF");
  });
  it("prioritizes locked commitments before retaining conflicting unlocked assignments", () => {
    const locked = shift("locked", "2026-11-01", "12:00", "20:00", ["a"]);
    locked.assignments[0].locked = true;
    const earlier = shift("earlier", "2026-11-01", "08:00", "16:00", ["a"]);
    const result = autoSchedule([earlier, locked], [employee("a"), employee("b")], DEFAULT_RULES, [], { mode: "repair" });
    expect(result.shifts[1]).toEqual(locked);
    expect(result.shifts[0].assignments[0].employeeId).toBe("b");
    expect(result.issues).toEqual([]);
  });
});
