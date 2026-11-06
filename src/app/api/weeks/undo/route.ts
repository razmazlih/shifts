import { requireUser } from "@/lib/auth";
import { ApiError, body, json, route, revisionSchema } from "@/lib/validation";
import { mutateWeek, undoTarget } from "@/lib/weeks";
import type { Shift } from "@/lib/types";
export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(request, revisionSchema);
  let action = "UNDO";
  return json(
    await mutateWeek(
      user,
      data.weekStart,
      data.revision,
      () => action,
      async (_shifts, tx) => {
        const history = await tx.audit.findMany({
          where: { weekStart: data.weekStart },
          select: { id: true, action: true, revision: true },
        });
        const target = undoTarget(history);
        if (!target) throw new ApiError(400, "אין שינוי קודם לביטול");
        const previous = await tx.audit.findUniqueOrThrow({
          where: { id: target.id },
          select: { beforeShifts: true },
        });
        action = `UNDO:${target.revision}`;
        return previous.beforeShifts as unknown as Shift[];
      },
    ),
  );
});
