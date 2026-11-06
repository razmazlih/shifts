import { requireUser } from "@/lib/auth";
import {
  ApiError,
  body,
  json,
  route,
  revisionSchema,
  weekSchema,
} from "@/lib/validation";
import { mutateWeek, moveShifts } from "@/lib/weeks";
import type { Shift } from "@/lib/types";
export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(
    request,
    revisionSchema.extend({ sourceWeek: weekSchema }),
  );
  if (data.sourceWeek === data.weekStart)
    throw new ApiError(400, "יש לבחור שבוע מקור שונה");
  return json(
    await mutateWeek(
      user,
      data.weekStart,
      data.revision,
      "COPY",
      async (_shifts, tx) => {
        const source = await tx.week.findUnique({
          where: { weekStart: data.sourceWeek },
        });
        if (!source) throw new ApiError(404, "שבוע המקור לא נמצא");
        return moveShifts(
          source.shifts as unknown as Shift[],
          data.sourceWeek,
          data.weekStart,
        );
      },
    ),
  );
});
