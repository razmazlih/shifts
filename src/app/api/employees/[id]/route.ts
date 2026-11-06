import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  ApiError,
  body,
  employeeFields,
  idSchema,
  json,
  route,
} from "@/lib/validation";
import { asJson, employeeData } from "@/lib/weeks";
import type { TimeOff } from "@/lib/types";
export const PUT = route(async (request) => {
  await requireUser(true);
  const id = idSchema.parse(
    new URL(request.url).pathname.split("/").filter(Boolean).at(-1),
  );
  const { employee } = await body(
    request,
    z.object({ employee: employeeFields.extend({ id: idSchema, updatedAt: z.string().datetime({ offset: true }) }) }).strict(),
  );
  if (employee.id !== id) throw new ApiError(400, "מזהה העובד אינו תואם");
  const updated = await db.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({ where: { id } });
    if (!current) throw new ApiError(404, "העובד לא נמצא");
    if (current.updatedAt.getTime() !== Date.parse(employee.updatedAt))
      throw new ApiError(409, "פרטי העובד השתנו מאז הטעינה. השינוי לא נשמר; יש לרענן לפני שמירה נוספת.");
    const requestOwned = (current.timeOff as unknown as TimeOff[]).filter(item => item.requestId);
    for (const item of employee.timeOff.filter(item => item.requestId)) {
      const saved = requestOwned.find(entry => entry.requestId === item.requestId);
      if (!saved) throw new ApiError(409, "אילוץ שמנוהל דרך בקשה השתנה או אינו קיים. רעננו את פרטי העובד.");
      if (item.start !== saved.start || item.end !== saved.end || (item.reason ?? "") !== (saved.reason ?? ""))
        throw new ApiError(422, "אילוץ שנוצר מבקשה מאושרת ניתן לשנות רק דרך מסך הבקשות.");
    }
    // A stale team form cannot erase an approval that arrived after it loaded.
    const timeOff = [...employee.timeOff.filter(item => !item.requestId), ...requestOwned];
    if (timeOff.length > 100) throw new ApiError(422, "לא ניתן לשמור יותר מ־100 אילוצים, כולל בקשות שאושרו.");
    const user = await tx.user.findUnique({ where: { employeeId: id } });
    if (user && !employee.email)
      throw new ApiError(400, "לא ניתן להסיר דוא״ל מעובד בעל חשבון התחברות");
    const row = await tx.employee.update({
      where: { id },
      data: {
        name: employee.name, active: employee.active, groups: employee.groups,
        maxWeeklyHours: employee.maxWeeklyHours, preferredDays: employee.preferredDays,
        email: employee.email || null,
        availability: asJson(employee.availability),
        timeOff: asJson(timeOff),
      },
    });
    if (user) {
      await tx.user.update({
        where: { id: user.id },
        data: { name: employee.name, email: employee.email! },
      });
      if (!employee.active)
        await tx.session.deleteMany({ where: { userId: user.id } });
    }
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return json({ employee: employeeData(updated) });
});
