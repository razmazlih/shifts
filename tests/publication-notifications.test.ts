import { describe, expect, it, vi } from "vitest";
import { createPublicationUpdates, personalPublicationChanges } from "../src/lib/publication-notifications";
import { affectedEmployeeIds } from "../src/lib/publication-diff";
import type { Shift } from "../src/lib/types";
import type { Tx } from "../src/lib/weeks";
const original: Shift = { id: "shift", title: "סיור", group: "PATROL", start: "2030-06-02T06:00:00Z", end: "2030-06-02T10:00:00Z", required: 2,
  note: "management-secret", assignments: [{ employeeId: "a", start: "2030-06-02T06:00:00Z", end: "2030-06-02T10:00:00Z", locked: true }] };

describe("personal publication updates", () => {
  it("distinguishes additions, cancellation and changed work", () => {
    expect(personalPublicationChanges([], [original], "a")[0].kind).toBe("added");
    expect(personalPublicationChanges([original], [], "a")[0].kind).toBe("canceled");
    expect(personalPublicationChanges([original], [{ ...original, title: "סיור מעודכן" }], "a")[0].kind).toBe("changed");
  });
  it("never includes colleagues or managerial data", () => {
    const shift = { ...original, assignments: [...original.assignments, { ...original.assignments[0], employeeId: "private-colleague" }] };
    const serialized = JSON.stringify(personalPublicationChanges([], [shift], "a"));
    for (const privateValue of ["private-colleague", "management-secret", "employeeId", "locked", "required", "note"])
      expect(serialized).not.toContain(privateValue);
    expect(personalPublicationChanges([original], [{ ...shift, note: "changed-secret" }], "a")).toEqual([]);
  });
  it("ignores internal assignment splits and equivalent timestamp offsets", () => {
    const after = { ...original, assignments: [
      { employeeId: "a", start: "2030-06-02T09:00:00+03:00", end: "2030-06-02T11:00:00+03:00" },
      { employeeId: "a", start: "2030-06-02T08:00:00Z", end: "2030-06-02T10:00:00Z" },
    ] };
    expect(personalPublicationChanges([original], [after], "a")).toEqual([]);
    expect(affectedEmployeeIds([original], [after])).toEqual([]);
  });
  it("creates only affected employee rows and uses the database duplicate guard", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { employeeUpdate: { createMany } } as unknown as Tx;
    const unchangedB = { ...original, id: "other", assignments: [{ ...original.assignments[0], employeeId: "b" }] };
    await createPublicationUpdates(tx, "publication", "2030-06-02", [unchangedB], [original, unchangedB]);
    expect(createMany).toHaveBeenCalledExactlyOnceWith({ data: [expect.objectContaining({ publicationId: "publication", employeeId: "a", weekStart: "2030-06-02" })], skipDuplicates: true });
  });
  it("does not create an event for identical personal publications", async () => {
    const createMany = vi.fn();
    await createPublicationUpdates({ employeeUpdate: { createMany } } as unknown as Tx, "publication", "2030-06-02", [original], [{ ...original, note: "another note" }]);
    expect(createMany).not.toHaveBeenCalled();
  });
});
