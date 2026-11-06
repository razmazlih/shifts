import { Prisma } from "@prisma/client";
import { db } from "./db";
import { addDays, localDate, weekStart } from "./time";
import { ApiError } from "./validation";
import { asJson, type Tx } from "./weeks";
import type { SessionUser, Shift, TimeOff } from "./types";

export type RequestKind = "ABSENCE" | "CONSTRAINT";
export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type RequestAction = "approve" | "reject" | "cancel";
export interface RequestEvent { status: RequestStatus; at: string; actorId: string; note: string; revision: number }
export interface RequestInput { submissionKey: string; kind: RequestKind; start: string; end: string; reason: string }
export interface RequestImpact {
  shiftId: string; title: string; weekStart: string; source: "draft" | "published"; start: string; end: string;
}
export interface EmployeeRequestView {
  id: string; employeeId: string; employeeName?: string; kind: RequestKind; start: string; end: string;
  reason: string; status: RequestStatus; revision: number; decisionNote: string; createdAt: string;
  reviewedAt: string | null; history: Omit<RequestEvent, "actorId">[]; impacts?: RequestImpact[];
}
type RequestRow = {
  id: string; employeeId: string; kind: RequestKind; start: Date; end: Date; reason: string;
  status: RequestStatus; revision: number; decisionNote: string; createdAt: Date;
  reviewedAt: Date | null; history: unknown; employee?: { name: string };
};

function assertLinked(user: SessionUser): string {
  if (!user.employeeId) throw new ApiError(403, "נדרש חשבון עובד מקושר להגשת בקשה");
  return user.employeeId;
}
export function requestProjection(row: RequestRow, admin: boolean): EmployeeRequestView {
  return {
    id: row.id, employeeId: row.employeeId, ...(admin && row.employee ? { employeeName: row.employee.name } : {}),
    kind: row.kind, start: row.start.toISOString(), end: row.end.toISOString(), reason: row.reason,
    status: row.status, revision: row.revision, decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(), reviewedAt: row.reviewedAt?.toISOString() ?? null,
    history: (row.history as RequestEvent[]).map(({ status, at, note, revision }) => ({ status, at, note, revision })),
  };
}
export function requestImpacts(request: { employeeId: string; start: Date; end: Date }, weeks: { weekStart: string; shifts: unknown; publications: { shifts: unknown }[] }[]): RequestImpact[] {
  const intersects = (start: string, end: string) => Date.parse(start) < request.end.getTime() && Date.parse(end) > request.start.getTime();
  return weeks.flatMap(week => ([
    { source: "draft" as const, shifts: week.shifts },
    { source: "published" as const, shifts: week.publications[0]?.shifts ?? [] },
  ]).flatMap(({ source, shifts }) => (shifts as Shift[]).flatMap(shift => shift.assignments
    .filter(assignment => assignment.employeeId === request.employeeId && intersects(assignment.start, assignment.end))
    .map(assignment => ({ shiftId: shift.id, title: shift.title, weekStart: week.weekStart, source, start: assignment.start, end: assignment.end })))))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.source.localeCompare(b.source));
}

export async function listEmployeeRequests(user: SessionUser, options: { id?: string; cursor?: string; status?: RequestStatus | "ALL" } = {}, tx: Tx = db): Promise<{ requests: EmployeeRequestView[]; nextCursor: string | null }> {
  const admin = user.role === "ADMIN";
  const employeeId = admin ? undefined : assertLinked(user);
  const { id, cursor } = options;
  const status = options.status ?? (admin ? "PENDING" : "ALL");
  if (cursor && !await tx.employeeRequest.findFirst({ where: { id: cursor, ...(employeeId ? { employeeId } : {}) }, select: { id: true } }))
    throw new ApiError(404, "נקודת ההמשך לא נמצאה. רעננו את הרשימה.");
  const found = await tx.employeeRequest.findMany({
    where: { ...(employeeId ? { employeeId } : {}), ...(id ? { id } : status === "ALL" ? {} : { status }) },
    include: admin ? { employee: { select: { name: true } } } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: id ? 1 : 51,
    ...(cursor && !id ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const rows = found.slice(0, 50);
  const nextCursor = found.length > 50 ? rows.at(-1)!.id : null;
  if (id && !rows.length) throw new ApiError(404, "הבקשה לא נמצאה");
  if (!admin || !rows.length) return { requests: rows.map(row => requestProjection(row, admin)), nextCursor };
  const weeks = await tx.week.findMany({
    where: { OR: rows.map(row => ({ weekStart: { gte: addDays(weekStart(localDate(row.start.toISOString())), -7), lte: weekStart(localDate(row.end.toISOString())) } })) },
    select: { weekStart: true, shifts: true, publications: { orderBy: { revision: "desc" }, take: 1, select: { shifts: true } } },
  });
  return { requests: rows.map(row => ({ ...requestProjection(row, true), impacts: requestImpacts(row, weeks) })), nextCursor };
}

export async function createEmployeeRequest(user: SessionUser, input: RequestInput) {
  const employeeId = assertLinked(user);
  return db.$transaction(async tx => {
    const existing = await tx.employeeRequest.findUnique({ where: { employeeId_submissionKey: { employeeId, submissionKey: input.submissionKey } } });
    if (existing) {
      if (existing.kind !== input.kind || existing.start.getTime() !== Date.parse(input.start) || existing.end.getTime() !== Date.parse(input.end) || existing.reason !== input.reason)
        throw new ApiError(409, "הבקשה כבר נשמרה עם פרטים אחרים. רעננו את רשימת הבקשות לפני הגשה נוספת.");
      return requestProjection(existing, false);
    }
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { active: true } });
    if (!employee?.active) throw new ApiError(403, "לא ניתן להגיש בקשה לחשבון שאינו פעיל");
    const event: RequestEvent = { status: "PENDING", at: new Date().toISOString(), actorId: user.id, note: "הבקשה הוגשה", revision: 0 };
    const row = await tx.employeeRequest.create({ data: {
      employeeId, submissionKey: input.submissionKey, kind: input.kind, start: new Date(input.start), end: new Date(input.end), reason: input.reason,
      history: asJson([event]),
    } });
    return requestProjection(row, false);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function decideEmployeeRequest(user: SessionUser, id: string, revision: number, action: RequestAction, decisionNote = "") {
  return db.$transaction(async tx => {
    const row = await tx.employeeRequest.findFirst({ where: { id, ...(user.role === "ADMIN" ? {} : { employeeId: assertLinked(user) }) } });
    if (!row) throw new ApiError(404, "הבקשה לא נמצאה");
    if (row.revision !== revision) throw new ApiError(409, "הבקשה השתנתה מאז הטעינה. רעננו לפני החלטה נוספת.");
    const admin = user.role === "ADMIN";
    if (action !== "cancel" && !admin) throw new ApiError(403, "רק מנהל יכול להחליט בבקשה");
    if (row.status === "REJECTED" || row.status === "CANCELLED") throw new ApiError(409, "הבקשה כבר סגורה. ניתן להגיש בקשה חדשה.");
    if (row.status === "APPROVED" && (!admin || action !== "cancel"))
      throw new ApiError(409, "לביטול בקשה שאושרה יש לפנות למנהל. רק מנהל יכול לבטל אישור ולהסיר את האילוץ שנוצר.");
    const status: RequestStatus = action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "CANCELLED";
    const now = new Date();
    if (action === "approve" || row.status === "APPROVED") {
      const employee = await tx.employee.findUnique({ where: { id: row.employeeId } });
      if (!employee) throw new ApiError(404, "העובד לא נמצא");
      if (action === "approve" && !employee.active) throw new ApiError(409, "העובד אינו פעיל. לא ניתן לאשר את הבקשה.");
      const current = employee.timeOff as unknown as TimeOff[];
      const retained = current.filter(item => item.requestId !== row.id);
      const next = action === "approve" ? [...retained, {
        start: row.start.toISOString(), end: row.end.toISOString(), reason: row.reason, requestId: row.id,
      }] : retained;
      if (next.length > 100) throw new ApiError(422, "לעובד כבר יש 100 אילוצים. יש להסיר אילוצים ישנים לפני אישור נוסף.");
      await tx.employee.update({ where: { id: row.employeeId }, data: { timeOff: asJson(next) } });
    }
    const event: RequestEvent = { status, at: now.toISOString(), actorId: user.id, note: decisionNote, revision: revision + 1 };
    const changed = await tx.employeeRequest.updateMany({
      where: { id, revision, status: row.status },
      data: { status, revision: revision + 1, decisionNote, reviewedById: user.id, reviewedAt: now, history: asJson([...(row.history as unknown as RequestEvent[]), event]) },
    });
    if (changed.count !== 1) throw new ApiError(409, "הבקשה כבר עודכנה בידי משתמש אחר. רעננו את הרשימה.");
    const updated = await tx.employeeRequest.findUniqueOrThrow({ where: { id } });
    return requestProjection(updated, admin);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
