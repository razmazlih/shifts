import { afterEach, describe, expect, it, vi } from "vitest";
import { localToISO } from "../src/lib/time";
import { ApiError } from "../src/lib/validation";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), findMany: vi.fn() }));
vi.mock("../src/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("../src/lib/db", () => ({ db: { week: { findMany: mocks.findMany } } }));
import { GET } from "../src/app/api/me/schedule/route";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("personal schedule endpoint access and query", () => {
  it("requires authentication before querying the database", async () => {
    mocks.requireUser.mockRejectedValueOnce(new ApiError(401, "נדרשת התחברות"));
    const response = await GET(new Request("http://localhost/api/me/schedule"));
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("does not allow an unlinked account to choose another employee", async () => {
    mocks.requireUser.mockResolvedValueOnce({ id: "admin", role: "ADMIN", employeeId: null });
    const response = await GET(new Request("http://localhost/api/me/schedule?employeeId=other"));
    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("uses authenticated identity and reads no drafts, employee records, or notes into the response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(localToISO("2030-08-04", "10:00")));
    mocks.requireUser.mockResolvedValueOnce({ id: "worker", role: "EMPLOYEE", employeeId: "own" });
    const start = localToISO("2030-08-11", "22:00"), end = localToISO("2030-08-12", "06:00");
    mocks.findMany.mockResolvedValueOnce([{ weekStart: "2030-08-11", publications: [{ shifts: [{ id: "published", title: "סיור", start, end, group: "PATROL", required: 2, note: "secret", assignments: [{ employeeId: "own", start, end, locked: true }, { employeeId: "other", start, end }] }] }] }]);
    const response = await GET(new Request("http://localhost/api/me/schedule?employeeId=other&version=draft"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const value = await response.json();
    expect(value.nextShift.shiftId).toBe("published");
    expect(value.upcomingShifts).toHaveLength(1);
    for (const privateField of ["secret", "other", "locked", "employeeId"])
      expect(JSON.stringify(value)).not.toContain(privateField);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { weekStart: { gte: "2030-07-28" } },
      orderBy: { weekStart: "asc" },
      select: { weekStart: true, publications: { orderBy: { revision: "desc" }, take: 1, select: { shifts: true } } },
    });
  });
});
