import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, body, json, route, weekSchema } from "@/lib/validation";
export const GET = route(async () => {
  await requireUser(true);
  return json({
    templates: await db.template.findMany({
      select: { id: true, name: true, sourceWeek: true, shifts: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  });
});
export const POST = route(async (request) => {
  await requireUser(true);
  const data = await body(
    request,
    z
      .object({
        name: z.string().trim().min(1).max(100),
        weekStart: weekSchema,
      })
      .strict(),
  );
  const week = await db.week.findUnique({
    where: { weekStart: data.weekStart },
  });
  if (!week) throw new ApiError(404, "השבוע לא נמצא");
  if ((await db.template.count()) >= 100)
    throw new ApiError(409, "הגעתם למגבלת 100 תבניות");
  // Templates retain staffing requirements, not personal assignments or notes.
  const shifts = (week.shifts as unknown as import("@/lib/types").Shift[]).map(
    (shift) => ({ ...shift, note: undefined, assignments: [] }),
  );
  const template = await db.template.create({
    data: {
      name: data.name,
      sourceWeek: data.weekStart,
      shifts: JSON.parse(JSON.stringify(shifts)),
    },
  });
  return json({ template }, 201);
});
