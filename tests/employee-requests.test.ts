import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmployeeRequest, decideEmployeeRequest, listEmployeeRequests, requestImpacts, requestProjection, type RequestEvent, type RequestStatus } from "../src/lib/employee-requests";
import { localToISO } from "../src/lib/time";
import type { SessionUser, Shift } from "../src/lib/types";
import type { Tx } from "../src/lib/weeks";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("../src/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
const employee: SessionUser = { id: "user-own", employeeId: "employee-own", name: "עובד", role: "EMPLOYEE" };
const admin: SessionUser = { id: "user-admin", employeeId: null, name: "מנהל", role: "ADMIN" };
const start = localToISO("2030-08-04", "20:00"), end = localToISO("2030-08-05", "04:00");
function row(status: RequestStatus = "PENDING") {
  return { id: "request-one", employeeId: employee.employeeId!, submissionKey: "submission", kind: "ABSENCE" as const, start: new Date(start), end: new Date(end), reason: "סיבה אישית",
    status, revision: 0, decisionNote: "", createdAt: new Date(start), reviewedAt: null,
    history: [{ status: "PENDING", actorId: "private-user-id", at: start, note: "הוגשה", revision: 0 }] as RequestEvent[],
    employee: { name: "שם עובד" } };
}
function fixture(status: RequestStatus = "PENDING") {
  const request = row(status);
  const tx = {
    employeeRequest: { findFirst: vi.fn().mockResolvedValue(request), findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([request]), create: vi.fn().mockResolvedValue(request), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockImplementation(async () => request) },
    employee: { findUnique: vi.fn().mockResolvedValue({ active: true, timeOff: [] }), update: vi.fn() },
    week: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() }, publication: { create: vi.fn() },
  };
  mocks.transaction.mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx));
  return { tx, request, client: tx as unknown as Tx };
}
beforeEach(() => vi.clearAllMocks());

describe("employee request ownership and privacy", () => {
  it("filters employee list by authenticated identity and never queries draft impacts", async () => {
    const f = fixture();
    const result = await listEmployeeRequests(employee, {}, f.client);
    expect(f.tx.employeeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: employee.employeeId }, take: 51 }));
    expect(result.requests[0]).not.toHaveProperty("impacts");
    expect(result.requests[0]).not.toHaveProperty("employeeName");
    expect(JSON.stringify(result)).not.toContain("private-user-id");
    expect(f.tx.week.findMany).not.toHaveBeenCalled();
  });

  it("returns404 for another employee request and rejects unauthorized decisions before writes", async () => {
    const f = fixture(); f.tx.employeeRequest.findFirst.mockResolvedValueOnce(null);
    await expect(decideEmployeeRequest(employee, "another-request", 0, "cancel")).rejects.toMatchObject({ status: 404 });
    expect(f.tx.employeeRequest.findFirst).toHaveBeenCalledWith({ where: { id: "another-request", employeeId: employee.employeeId } });
    await expect(decideEmployeeRequest(employee, f.request.id, 0, "approve")).rejects.toMatchObject({ status: 403 });
    expect(f.tx.employee.update).not.toHaveBeenCalled();
    expect(f.tx.employeeRequest.updateMany).not.toHaveBeenCalled();
  });

  it("provides a bounded page and a reachable continuation for older requests", async () => {
    const f = fixture();
    f.tx.employeeRequest.findMany.mockResolvedValue(Array.from({ length: 51 }, (_, index) => ({ ...row(), id: `request-${index}` })));
    const result = await listEmployeeRequests(employee, { status: "ALL" }, f.client);
    expect(result.requests).toHaveLength(50); expect(result.nextCursor).toBe("request-49");
    await listEmployeeRequests(employee, { status: "CANCELLED", cursor: "request-49" }, f.client);
    expect(f.tx.employeeRequest.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { employeeId: employee.employeeId, status: "CANCELLED" }, cursor: { id: "request-49" }, skip: 1 }));
  });

  it("manager queue defaults to pending, returns employee name, and checks only relevant request date ranges", async () => {
    const f = fixture();
    const result = await listEmployeeRequests(admin, {}, f.client);
    expect(f.tx.employeeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "PENDING" } }));
    expect(result.requests[0].employeeName).toBe("שם עובד");
    expect(f.tx.week.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ weekStart: { gte: "2030-07-28", lte: "2030-08-04" } }] } }));
  });
});

describe("request submission and decisions", () => {
  it("submission creates only the request and retry with identical key never duplicates it", async () => {
    const f = fixture();
    const input = { submissionKey: "submission", kind: "ABSENCE" as const, start, end, reason: "סיבה אישית" };
    await createEmployeeRequest(employee, input);
    expect(f.tx.employeeRequest.create).toHaveBeenCalledOnce();
    expect(f.tx.employee.update).not.toHaveBeenCalled();
    expect(f.tx.week.update).not.toHaveBeenCalled();
    expect(f.tx.publication.create).not.toHaveBeenCalled();
    f.tx.employeeRequest.findUnique.mockResolvedValue(f.request);
    await createEmployeeRequest(employee, input);
    expect(f.tx.employeeRequest.create).toHaveBeenCalledOnce();
    await expect(createEmployeeRequest(employee, { ...input, reason: "פרטים שונים" })).rejects.toMatchObject({ status: 409 });
  });

  it("approval adds one request-owned interval atomically and retains existing constraints and history", async () => {
    const f = fixture(); const manual = { start, end, reason: "אילוץ ידני" };
    f.tx.employee.findUnique.mockResolvedValue({ active: true, timeOff: [manual] });
    await decideEmployeeRequest(admin, f.request.id, 0, "approve", "אושר לאחר בדיקה");
    expect(f.tx.employee.update).toHaveBeenCalledWith({ where: { id: employee.employeeId }, data: { timeOff: [manual, { start: f.request.start.toISOString(), end: f.request.end.toISOString(), reason: f.request.reason, requestId: f.request.id }] } });
    expect(f.tx.employeeRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: f.request.id, revision: 0, status: "PENDING" }, data: expect.objectContaining({ status: "APPROVED", revision: 1, reviewedById: admin.id, history: [f.request.history[0], expect.objectContaining({ status: "APPROVED", note: "אושר לאחר בדיקה" })] }) }));
    expect(f.tx.week.update).not.toHaveBeenCalled(); expect(f.tx.publication.create).not.toHaveBeenCalled();
  });

  it("worker can cancel pending only; manager withdrawal removes exactly the matching tagged interval", async () => {
    const f = fixture("APPROVED");
    const manual = { start, end, reason: "ידני" }, other = { start, end, requestId: "another-request" }, own = { start, end, requestId: f.request.id };
    f.tx.employee.findUnique.mockResolvedValue({ active: true, timeOff: [manual, other, own] });
    await expect(decideEmployeeRequest(employee, f.request.id, 0, "cancel")).rejects.toMatchObject({ status: 409 });
    expect(f.tx.employee.update).not.toHaveBeenCalled();
    await decideEmployeeRequest(admin, f.request.id, 0, "cancel");
    expect(f.tx.employee.update).toHaveBeenCalledWith({ where: { id: employee.employeeId }, data: { timeOff: [manual, other] } });
    f.request.status = "PENDING";
    await decideEmployeeRequest(employee, f.request.id, 0, "cancel");
    expect(f.tx.employeeRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }));
  });

  it("rejects stale decisions before touching employee constraints", async () => {
    const f = fixture(); f.request.revision = 2;
    await expect(decideEmployeeRequest(admin, f.request.id, 1, "approve")).rejects.toMatchObject({ status: 409 });
    expect(f.tx.employee.update).not.toHaveBeenCalled(); expect(f.tx.employeeRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe("request impact and safe history projection", () => {
  it("uses actual employee assignment intervals, treats endpoints as nonoverlapping, and preserves source distinction", () => {
    const shift: Shift = { id: "night", title: "סיור לילה", group: "PATROL", start, end, required: 2, assignments: [
      { employeeId: employee.employeeId!, start, end },
      { employeeId: "other", start, end },
    ] };
    const request = { employeeId: employee.employeeId!, start: new Date(localToISO("2030-08-05", "00:00")), end: new Date(end) };
    const impacts = requestImpacts(request, [{ weekStart: "2030-08-04", shifts: [shift], publications: [{ shifts: [shift] }] }]);
    expect(impacts).toHaveLength(2); expect(impacts.map(item => item.source).sort()).toEqual(["draft", "published"]);
    expect(requestImpacts({ ...request, start: new Date(end), end: new Date(Date.parse(end) + 3600000) }, [{ weekStart: "2030-08-04", shifts: [shift], publications: [] }])).toEqual([]);
  });
  it("never projects decision actor identifiers", () => {
    const result = requestProjection(row(), false);
    expect(result.history[0]).not.toHaveProperty("actorId");
    expect(result).not.toHaveProperty("submissionKey");
  });
});
