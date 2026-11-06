import { describe, expect, it } from "vitest";
import { undoTarget } from "../src/lib/weeks";
describe("persistent undo history", () => {
  it("walks edits backwards without toggling and ignores publication snapshots", () => {
    const history = [
      { revision: 1, action: "SEED" },
      { revision: 2, action: "SAVE" },
      { revision: 3, action: "AUTO" },
      { revision: 4, action: "PUBLISH" },
    ];
    expect(undoTarget(history)?.revision).toBe(3);
    history.push({ revision: 5, action: "UNDO:3" });
    expect(undoTarget(history)?.revision).toBe(2);
    history.push({ revision: 6, action: "UNDO:2" });
    expect(undoTarget(history)).toBeUndefined();
  });
  it("undoes edits after an undo before continuing to earlier active edits", () => {
    const history = [
      { revision: 1, action: "SAVE" },
      { revision: 2, action: "SAVE" },
      { revision: 3, action: "UNDO:2" },
      { revision: 4, action: "COPY" },
    ];
    expect(undoTarget(history)?.revision).toBe(4);
    history.push({ revision: 5, action: "UNDO:4" });
    expect(undoTarget(history)?.revision).toBe(1);
  });
});
