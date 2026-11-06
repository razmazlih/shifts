import { z } from "zod";
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
export const PUT = route(async (request) => {
  await requireUser(true);
  const id = idSchema.parse(
    new URL(request.url).pathname.split("/").filter(Boolean).at(-1),
  );
  const { employee } = await body(
    request,
    z.object({ employee: employeeFields.extend({ id: idSchema }) }).strict(),
  );
  if (employee.id !== id) throw new ApiError(400, "מזהה העובד אינו תואם");
  const updated = await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { employeeId: id } });
    if (user && !employee.email)
      throw new ApiError(400, "לא ניתן להסיר דוא״ל מעובד בעל חשבון התחברות");
    const row = await tx.employee.update({
      where: { id },
      data: {
        ...employee,
        email: employee.email || null,
        availability: asJson(employee.availability),
        timeOff: asJson(employee.timeOff),
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
  });
  return json({ employee: employeeData(updated) });
});
