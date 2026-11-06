import { z } from "zod";
import { applyTemplateShifts } from "@/lib/templates";
import { requireUser } from "@/lib/auth";
import { ApiError, body, json, route, revisionSchema, idSchema, schedulingScopeSchema } from "@/lib/validation";
import { mutateWeek } from "@/lib/weeks";
import { createSchedulingProposal, verifyProposalChanges } from "@/lib/schedule-proposals";
import { inSchedulingScope } from "@/lib/scheduler";
import type { Shift, SchedulingScope } from "@/lib/types";
export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(request, revisionSchema.extend({
    templateId: idSchema,
    targetDay: z.number().int().min(0).max(6).optional(),
    allDays: z.boolean().optional(),
    autoSchedule: z.boolean().optional(),
    mode: z.enum(["fill", "repair"]).default("fill"),
    scope: schedulingScopeSchema.optional(),
  }));
  if (data.targetDay !== undefined && data.allDays)
    throw new ApiError(400, "יש לבחור יום יעד או את כל השבוע");
  const scope: SchedulingScope = data.scope ?? {
    days: data.targetDay === undefined ? [0, 1, 2, 3, 4, 5, 6] : [data.targetDay],
    groups: ["MANAGERS", "PATROL"],
  };
  if (data.targetDay !== undefined && (scope.days.length !== 1 || scope.days[0] !== data.targetDay))
    throw new ApiError(400, "תחום הפעולה חייב להתאים ליום היעד");
  if (data.autoSchedule)
    return json(await createSchedulingProposal(user, { ...data, scope }));
  return json(await mutateWeek(user, data.weekStart, data.revision, "TEMPLATE", async (shifts, tx) => {
    const template = await tx.template.findUnique({ where: { id: data.templateId } });
    if (!template) throw new ApiError(404, "התבנית לא נמצאה");
    const applied = applyTemplateShifts(shifts, {
      shifts: template.shifts as unknown as Shift[], sourceWeek: template.sourceWeek,
    }, data.weekStart, data.targetDay, data.allDays);
    const next = [
      ...shifts.filter((shift) => !inSchedulingScope(shift, scope)),
      ...applied.filter((shift) => inSchedulingScope(shift, scope)),
    ];
    verifyProposalChanges(shifts, next, "repair", scope);
    return next;
  }));
});
