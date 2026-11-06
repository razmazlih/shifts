import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, body, json, route, weekSchema, idSchema } from "@/lib/validation";
import { createTemplateEntries, createTemplateShifts, templateEntriesSchema, templateScope } from "@/lib/templates";
import type { Shift } from "@/lib/types";
export const GET = route(async () => {
  await requireUser(true);
  return json({
    templates: (await db.template.findMany({
      select: { id: true, name: true, sourceWeek: true, shifts: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    })).map((template) => ({ ...template, scope: templateScope(template.shifts as unknown as Shift[]) })),
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
        sourceDay: z.number().int().min(0).max(6).optional(),
        repeatAllDays: z.boolean().optional(),
        entries: templateEntriesSchema.optional(),
      })
      .strict().refine((value) => !value.entries || (value.sourceDay === undefined && value.repeatAllDays === undefined),
        "יש לבחור יצירת תבנית חדשה או שמירה מהלוח"),
  );
  const week = data.entries ? null : await db.week.findUnique({
    where: { weekStart: data.weekStart },
  });
  if (!data.entries && !week) throw new ApiError(404, "השבוע לא נמצא");
  if ((await db.template.count()) >= 100)
    throw new ApiError(409, "הגעתם למגבלת 100 תבניות");
  const shifts = data.entries
    ? createTemplateEntries(data.entries, data.weekStart)
    : createTemplateShifts(week!.shifts as unknown as Shift[], data.weekStart, data.sourceDay, data.repeatAllDays);
  const template = await db.template.create({
    data: {
      name: data.name,
      sourceWeek: data.weekStart,
      shifts: JSON.parse(JSON.stringify(shifts)),
    },
  });
  return json({ template }, 201);
});

export const DELETE = route(async (request) => {
  await requireUser(true);
  const data = await body(request, z.object({ templateId: idSchema }).strict());
  await db.template.delete({ where: { id: data.templateId } });
  return json({ deleted: true });
});
