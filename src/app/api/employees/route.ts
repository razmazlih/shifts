import { z } from "zod";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  ApiError,
  body,
  employeeFields,
  passwordSchema,
  json,
  route,
} from "@/lib/validation";
import { asJson, employeeData, safeEmployee } from "@/lib/weeks";
export const GET = route(async () => {
  const user = await requireUser();
  const employees = (
    await db.employee.findMany({ orderBy: { name: "asc" } })
  ).map(employeeData);
  return json({
    employees: user.role === "ADMIN" ? employees : employees.map(safeEmployee),
  });
});
export const POST = route(async (request) => {
  await requireUser(true);
  const { employee, password } = await body(
    request,
    z
      .object({ employee: employeeFields, password: passwordSchema.optional() })
      .strict(),
  );
  if (password && !employee.email)
    throw new ApiError(400, "נדרשת כתובת דוא״ל ליצירת גישה לעובד");
  if (employee.timeOff.some(item => item.requestId))
    throw new ApiError(400, "אילוץ שמקושר לבקשה נוצר רק באמצעות אישור בקשה קיימת.");
  const passwordHash = password ? await hash(password, 12) : null;
  const created = await db.$transaction(async (tx) => {
    const row = await tx.employee.create({
      data: {
        ...employee,
        email: employee.email || null,
        availability: asJson(employee.availability),
        timeOff: asJson(employee.timeOff),
      },
    });
    if (passwordHash && employee.email)
      await tx.user.create({
        data: {
          email: employee.email,
          name: employee.name,
          passwordHash,
          role: "EMPLOYEE",
          employeeId: row.id,
        },
      });
    return row;
  });
  return json({ employee: employeeData(created) }, 201);
});
