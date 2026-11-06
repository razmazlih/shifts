import { requireUser } from "@/lib/auth";
import {
  ApiError,
  body,
  json,
  route,
  revisionSchema,
  idSchema,
} from "@/lib/validation";
import { mutateWeek, moveShifts } from "@/lib/weeks";
import type { Shift } from "@/lib/types";
export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(
    request,
    revisionSchema.extend({ templateId: idSchema }),
  );
  return json(
    await mutateWeek(
      user,
      data.weekStart,
      data.revision,
      "TEMPLATE",
      async (_shifts, tx) => {
        const template = await tx.template.findUnique({
          where: { id: data.templateId },
        });
        if (!template) throw new ApiError(404, "התבנית לא נמצאה");
        return moveShifts(
          template.shifts as unknown as Shift[],
          template.sourceWeek,
          data.weekStart,
        );
      },
    ),
  );
});
