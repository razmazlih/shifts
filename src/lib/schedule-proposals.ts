import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { db } from "./db";
import { autoSchedule, getCandidates, inSchedulingScope, validateSchedule } from "./scheduler";
import { coverageGaps } from "./coverage";
import { templateScope } from "./templates";
import { addDays, localDate } from "./time";
import { ApiError, shiftsSchema } from "./validation";
import { asJson, employeeData, getRules, moveShifts, mutateWeek, neighborContext, type Tx } from "./weeks";
import type { AutoScheduleSummary, Assignment, Employee, Issue, Rules, SchedulingMode, SchedulingProposal, SchedulingScope, SessionUser, Shift } from "./types";

export interface SchedulingRequest {
  weekStart: string;
  revision: number;
  mode: SchedulingMode;
  scope: SchedulingScope;
  templateId?: string;
  templateRevision?: number;
}
// PostgreSQL JSONB and schema parsing may reorder object keys. Equality must
// compare content while retaining meaningful array order, never property order.
const identity = (value: unknown) => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item,
);
const assignmentKey = (assignment: Assignment) => identity(assignment);
const errorKey = (issue: Issue) => identity([issue.code, issue.shiftId, issue.employeeId ?? null, issue.message]);
const adminOnly = (user: SessionUser) => {
  if (user.role !== "ADMIN") throw new ApiError(403, "הפעולה מותרת למנהל בלבד");
};

/** Stable dependency digest. No tokens or employee data are returned in the digest. */
export function schedulingFingerprint(
  shifts: Shift[], employees: Employee[], rules: Rules, context: Shift[],
): string {
  return createHash("sha256").update(identity({
    shifts,
    employees: [...employees].sort((a, b) => a.id.localeCompare(b.id)),
    rules,
    context: [...context].sort((a, b) => a.id.localeCompare(b.id)),
  })).digest("hex");
}

function preservedAssignments(before: Assignment[], after: Assignment[]): boolean {
  const pool = after.map(assignmentKey);
  return before.every((assignment) => {
    const index = pool.indexOf(assignmentKey(assignment));
    if (index < 0) return false;
    pool.splice(index, 1);
    return true;
  });
}

/** Defense in depth for persisted proposals and future scheduling implementations. */
export function verifyProposalChanges(before: Shift[], after: Shift[], mode: SchedulingMode, scope: SchedulingScope) {
  const previous = new Map(before.map((shift) => [shift.id, shift]));
  const next = new Map(after.map((shift) => [shift.id, shift]));
  for (const shift of before) {
    const replacement = next.get(shift.id);
    if (!inSchedulingScope(shift, scope)) {
      if (identity(shift) !== identity(replacement)) throw new ApiError(409, "ההצעה חורגת מתחום הפעולה שנבחר");
      continue;
    }
    const locked = shift.assignments.filter((assignment) => assignment.locked);
    if (locked.length && (!replacement ||
      shift.start !== replacement.start || shift.end !== replacement.end || shift.group !== replacement.group ||
      !preservedAssignments(locked, replacement.assignments)))
      throw new ApiError(409, "לא ניתן לשנות שיבוץ נעול. יש לפתוח את המשמרת ולהחליט על הנעילה.");
    if (mode === "fill" && (!replacement ||
      identity({ ...shift, assignments: [] }) !== identity({ ...replacement, assignments: [] }) ||
      !preservedAssignments(shift.assignments, replacement.assignments)))
      throw new ApiError(409, "השלמת חוסרים אינה רשאית לשנות שיבוצים קיימים");
  }
  for (const shift of after) {
    if (!previous.has(shift.id) && !inSchedulingScope(shift, scope))
      throw new ApiError(409, "ההצעה מוסיפה משמרת מחוץ לתחום הפעולה");
  }
}

export function proposalSummary(before: Shift[], after: Shift[], issues: Issue[]): Pick<SchedulingProposal, "changes" | "summary"> {
  const previous = new Map(before.map((shift) => [shift.id, shift]));
  const next = new Map(after.map((shift) => [shift.id, shift]));
  const ids = [...new Set([...previous.keys(), ...next.keys()])];
  let addedAssignments = 0, changedAssignments = 0, unchangedAssignments = 0;
  for (const id of ids) {
    const pool = (next.get(id)?.assignments ?? []).map(assignmentKey);
    for (const assignment of previous.get(id)?.assignments ?? []) {
      const index = pool.indexOf(assignmentKey(assignment));
      if (index < 0) changedAssignments++;
      else { unchangedAssignments++; pool.splice(index, 1); }
    }
    addedAssignments += pool.length;
  }
  return {
    changes: ids.filter((id) => identity(previous.get(id)) !== identity(next.get(id)))
      .map((shiftId) => ({ shiftId, before: previous.get(shiftId) ?? null, after: next.get(shiftId) ?? null })),
    summary: { addedAssignments, changedAssignments, unchangedAssignments,
      unfilledShifts: new Set(issues.filter((issue) => issue.code === "UNDERSTAFFED").map((issue) => issue.shiftId)).size },
  };
}

/** Explain residual gaps in the saved preview; never change scheduling decisions. */
export function explainProposalIssues(
  issues: Issue[], shifts: Shift[], employees: Employee[], rules: Rules, context: Shift[], scope: SchedulingScope,
): Issue[] {
  return issues.map(issue => {
    if (issue.code !== "UNDERSTAFFED") return issue;
    const shift = shifts.find(item => item.id === issue.shiftId);
    if (!shift) return issue;
    if (!inSchedulingScope(shift, scope)) return { ...issue, message: `${issue.message}. המשמרת מחוץ לימים או לצוותים שנבחרו, ולכן לא בוצע בה שיבוץ.` };
    const gap = coverageGaps(shift).find(item => item.message === issue.message);
    if (!gap) return issue;
    const candidates = getCandidates(shift, shifts, employees, rules, context, gap);
    const eligible = candidates.filter(candidate => candidate.eligible);
    let explanation: string;
    if (!employees.some(employee => employee.active)) explanation = "אין נתוני עובדים פעילים להשלמת החוסר.";
    else if (!eligible.length) {
      const reasons = [...new Set(candidates.flatMap(candidate => candidate.reasons))].slice(0, 4);
      explanation = `לא נמצא עובד מתאים לכל המקטע בלי לשנות שיבוצים קיימים${reasons.length ? `: ${reasons.join("; ")}` : ". יש לבדוק את נתוני הצוות"}. אפשר לבדוק חלוקת שעות ידנית.`;
    } else {
      explanation = `נמצאו ${eligible.length} מועמדים שמתאימים למקטע בבדיקה פרטנית, אך המנוע לא השלים את החוסר. יש לפתוח את המשמרת לבדיקה ידנית; אין הבטחה לפתרון מיטבי.`;
    }
    return { ...issue, message: `${issue.message}. ${explanation}` };
  });
}

async function dependencies(weekStart: string, tx: Tx) {
  const [rows, rules, context] = await Promise.all([
    tx.employee.findMany(), getRules(tx), neighborContext(weekStart, tx),
  ]);
  return { employees: rows.map(employeeData), rules, context };
}

/** Create template requirements only inside the explicitly selected days/teams. */
export function scopedTemplateShifts(
  current: Shift[], template: { shifts: Shift[]; sourceWeek: string }, request: Pick<SchedulingRequest, "weekStart" | "mode" | "scope">,
): Shift[] {
  const selected = current.filter((shift) => inSchedulingScope(shift, request.scope));
  if (request.mode === "fill" && selected.length)
    throw new ApiError(409, "בתחום שנבחר כבר קיימות משמרות. להשלמת חוסרים בחרו ללא תבנית; החלפת משמרות דורשת מצב תיקון מפורש.");
  if (selected.some((shift) => shift.assignments.some((assignment) => assignment.locked)))
    throw new ApiError(409, "התבנית תחליף משמרת עם שיבוץ נעול. יש לשחרר את הנעילה במפורש או לבחור תחום אחר.");
  const clean = template.shifts.map((shift) => {
    const requirement = { ...shift, assignments: [] };
    delete requirement.note;
    return requirement;
  });
  const candidates = templateScope(clean) === "day"
    ? request.scope.days.flatMap((day) => moveShifts(clean, localDate(clean[0].start), addDays(request.weekStart, day)))
    : moveShifts(clean, template.sourceWeek, request.weekStart);
  const replacements = candidates.filter((shift) => inSchedulingScope(shift, request.scope));
  if (!replacements.length) throw new ApiError(400, "בתבנית אין משמרות לימים ולצוותים שנבחרו");
  return shiftsSchema.parse([...current.filter((shift) => !inSchedulingScope(shift, request.scope)), ...replacements]);
}

export async function createSchedulingProposal(user: SessionUser, request: SchedulingRequest): Promise<SchedulingProposal> {
  adminOnly(user);
  return db.$transaction(async (tx) => {
    const week = await tx.week.findUnique({ where: { weekStart: request.weekStart } });
    if ((week?.revision ?? 0) !== request.revision)
      throw new ApiError(409, "השבוע השתנה. יש לרענן לפני יצירת הצעה.");
    const before = (week?.shifts ?? []) as unknown as Shift[];
    const { employees, rules, context } = await dependencies(request.weekStart, tx);
    let input = before;
    if (request.templateId) {
      const template = await tx.template.findUnique({ where: { id: request.templateId } });
      if (!template) throw new ApiError(404, "התבנית לא נמצאה");
      if (request.templateRevision !== undefined && template.revision !== request.templateRevision)
        throw new ApiError(409, "התבנית השתנתה מאז הטעינה. יש לרענן לפני הכנת הצעה.");
      input = scopedTemplateShifts(before, { sourceWeek: template.sourceWeek, shifts: template.shifts as unknown as Shift[] }, request);
    }
    if (!input.some((shift) => inSchedulingScope(shift, request.scope)))
      throw new ApiError(400, "אין משמרות בתחום הפעולה. יש ליצור משמרות או לבחור תבנית.");
    const result = autoSchedule(input, employees, rules, context, request);
    result.issues = explainProposalIssues(result.issues, result.shifts, employees, rules, context, request.scope);
    verifyProposalChanges(before, result.shifts, request.mode, request.scope);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const proposal = await tx.scheduleProposal.create({ data: {
      actorId: user.id, weekStart: request.weekStart, revision: request.revision,
      mode: request.mode, scope: asJson(request.scope), shifts: asJson(result.shifts), issues: asJson(result.issues),
      fingerprint: schedulingFingerprint(before, employees, rules, context), expiresAt,
    } });
    return {
      id: proposal.id, weekStart: request.weekStart, revision: request.revision,
      mode: request.mode, scope: request.scope, shifts: result.shifts, issues: result.issues,
      ...proposalSummary(before, result.shifts, result.issues), expiresAt: expiresAt.toISOString(),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}

export async function applySchedulingProposal(user: SessionUser, proposalId: string) {
  adminOnly(user);
  // Only owner-scoped metadata is read outside the mutation transaction. The row
  // and every dependency are read again in the same serializable draft commit.
  const selected = await db.scheduleProposal.findFirst({ where: { id: proposalId, actorId: user.id } });
  if (!selected) throw new ApiError(404, "ההצעה לא נמצאה");
  let autoSummary: AutoScheduleSummary | undefined;
  let appliedIssues: Issue[] = [];
  const result = await mutateWeek(user, selected.weekStart, selected.revision, `AUTO_${selected.mode.toUpperCase()}`, async (before, tx) => {
    const proposal = await tx.scheduleProposal.findFirst({ where: { id: proposalId, actorId: user.id } });
    if (!proposal || proposal.usedAt || proposal.expiresAt.getTime() <= Date.now())
      throw new ApiError(409, "ההצעה פגה, בוטלה או כבר הוחלה. יש להכין הצעה חדשה.");
    const { employees, rules, context } = await dependencies(proposal.weekStart, tx);
    if (schedulingFingerprint(before, employees, rules, context) !== proposal.fingerprint)
      throw new ApiError(409, "ההצעה התיישנה בעקבות שינוי בסידור, בצוות, בזמינות או בכללים. יש להכין הצעה חדשה.");
    const after = shiftsSchema.parse(proposal.shifts);
    const mode = proposal.mode as SchedulingMode;
    const scope = proposal.scope as unknown as SchedulingScope;
    verifyProposalChanges(before, after, mode, scope);
    const existingErrors = new Set(validateSchedule(before, employees, rules, context)
      .filter((issue) => issue.severity === "error").map(errorKey));
    const afterIssues = validateSchedule(after, employees, rules, context);
    const remaining = afterIssues.filter((issue) => issue.severity === "error");
    const introduced = remaining.filter((issue) => !existingErrors.has(errorKey(issue)));
    if (introduced.length) throw new ApiError(422, "ההצעה אינה עומדת באילוצים. יש להכין הצעה חדשה.", introduced);
    const consumed = await tx.scheduleProposal.updateMany({
      where: { id: proposal.id, actorId: user.id, usedAt: null }, data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new ApiError(409, "ההצעה כבר הוחלה או בוטלה");
    appliedIssues = proposal.issues as unknown as Issue[];
    const summary = proposalSummary(before, after, afterIssues);
    const remainingKeys = new Set(remaining.map(errorKey));
    autoSummary = {
      changedShiftIds: summary.changes.map((change) => change.shiftId),
      resolvedErrors: [...existingErrors].filter((key) => !remainingKeys.has(key)).length,
      remainingErrors: remaining.length,
      unfilledShifts: summary.summary.unfilledShifts,
    };
    return after;
  });
  const known = new Set(result.issues.map(identity));
  return { ...result, autoSummary, issues: [...result.issues, ...appliedIssues.filter((issue) => issue.code !== "UNDERSTAFFED" && !known.has(identity(issue)))] };
}

export async function cancelSchedulingProposal(user: SessionUser, proposalId: string) {
  adminOnly(user);
  const changed = await db.scheduleProposal.updateMany({
    where: { id: proposalId, actorId: user.id, usedAt: null }, data: { usedAt: new Date() },
  });
  if (!changed.count) throw new ApiError(404, "ההצעה לא נמצאה או כבר נסגרה");
  return { canceled: true };
}
