import { z } from "zod";
import { applyTemplateShifts } from "@/lib/templates";
import { requireUser } from "@/lib/auth";
import {
  ApiError,
  body,
  json,
  route,
  revisionSchema,
  idSchema,
} from "@/lib/validation";
import { mutateWeek } from "@/lib/weeks";
import type { Shift } from "@/lib/types";
export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(
    request,
    revisionSchema.extend({ templateId: idSchema, targetDay: z.number().int().min(0).max(6).optional(), allDays: z.boolean().optional() }),
  );
  return json(
    await mutateWeek(
      user,
      data.weekStart,
      data.revision,
      "TEMPLATE",
      async (shifts, tx) => {
        const template = await tx.template.findUnique({
          where: { id: data.templateId },
        });
        if (!template) throw new ApiError(404, "התבנית לא נמצאה");
        return applyTemplateShifts(shifts, {
          shifts: template.shifts as unknown as Shift[],
          sourceWeek: template.sourceWeek,
        }, data.weekStart, data.targetDay, data.allDays);
      },
    ),
  );
});
