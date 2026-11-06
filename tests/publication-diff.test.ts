import { describe, expect, it } from "vitest";
import { affectedEmployeeIds, publicationChanges } from "../src/lib/publication-diff";
import type { Shift } from "../src/lib/types";
const original: Shift = { id: "shift", title: "סיור", group: "PATROL", start: "2030-06-02T06:00:00Z", end: "2030-06-02T10:00:00Z", required: 1,
  assignments: [{ employeeId: "a", start: "2030-06-02T06:00:00Z", end: "2030-06-02T10:00:00Z" }] };
describe("publication review impact", () => {
  it("reports added, changed and removed original records", () => {
    expect(publicationChanges([], [original])[0]).toEqual({ shiftId: "shift", before: null, after: original });
    expect(publicationChanges([original], [original])).toEqual([]);
    expect(publicationChanges([original], [])[0].after).toBeNull();
  });
  it("identifies both previous and replacement workers", () => {
    const replacement = { ...original, assignments: [{ ...original.assignments[0], employeeId: "b" }] };
    expect(affectedEmployeeIds([original], [replacement])).toEqual(["a", "b"]);
  });
  it("does not attribute a management note, lock or colleague change to a worker", () => {
    const updated = { ...original, note: "private", required: 2, assignments: [{ ...original.assignments[0], locked: true }, { ...original.assignments[0], employeeId: "b" }] };
    expect(affectedEmployeeIds([original], [updated])).toEqual(["b"]);
  });
});
