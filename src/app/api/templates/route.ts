import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, body, json, route, weekSchema, idSchema } from "@/lib/validation";
import { createTemplateEntries, createTemplateShifts, templateEntriesSchema, templateScope } from "@/lib/templates";
import { asJson } from "@/lib/weeks";
import type { Shift } from "@/lib/types";

const nameSchema = z.string().trim().min(1).max(100);
const revisionSchema = z.number().int().nonnegative().max(2147483646);
const stale = () => new ApiError(409, "התבנית השתנתה מאז הטעינה. יש לרענן לפני שמירה או מחיקה.");
const select = { id: true, name: true, revision: true, sourceWeek: true, shifts: true } as const;
const creation = z.object({ name: nameSchema, weekStart: weekSchema, sourceDay: z.number().int().min(0).max(6).optional(), repeatAllDays: z.boolean().optional(), entries: templateEntriesSchema.optional() }).strict().refine(value => !value.entries || (value.sourceDay === undefined && value.repeatAllDays === undefined), "יש לבחור יצירת תבנית חדשה או שמירה מהלוח");
const duplication = z.object({ cloneTemplateId: idSchema, revision: revisionSchema, name: nameSchema.optional() }).strict();

export const GET = route(async () => {
  const user = await requireUser(true);
  const templates = await db.template.findMany({ select: { ...select, favorites: { where: { userId: user.id }, select: { userId: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return json({ templates: templates.map(({ favorites, ...template }) => ({ ...template, favorite: favorites.length > 0, scope: templateScope(template.shifts as unknown as Shift[]) })).sort((a, b) => Number(b.favorite) - Number(a.favorite)) });
});

export const POST = route(async request => {
  await requireUser(true);
  const data = await body(request, z.union([creation, duplication]));
  const template = await db.$transaction(async tx => {
    if ((await tx.template.count()) >= 100) throw new ApiError(409, "הגעתם למגבלת 100 תבניות");
    if ("cloneTemplateId" in data) {
      const source = await tx.template.findUnique({ where: { id: data.cloneTemplateId } });
      if (!source) throw new ApiError(404, "התבנית לא נמצאה");
      if (source.revision !== data.revision) throw stale();
      const shifts = createTemplateShifts(source.shifts as unknown as Shift[], source.sourceWeek);
      return tx.template.create({ data: { name: data.name ?? `${source.name.slice(0, 91)} — העתק`, sourceWeek: source.sourceWeek, shifts: asJson(shifts) }, select });
    }
    const week = data.entries ? null : await tx.week.findUnique({ where: { weekStart: data.weekStart } });
    if (!data.entries && !week) throw new ApiError(404, "השבוע לא נמצא");
    const shifts = data.entries ? createTemplateEntries(data.entries, data.weekStart) : createTemplateShifts(week!.shifts as unknown as Shift[], data.weekStart, data.sourceDay, data.repeatAllDays);
    return tx.template.create({ data: { name: data.name, sourceWeek: data.weekStart, shifts: asJson(shifts) }, select });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return json({ template: { ...template, favorite: false } }, 201);
});

export const PATCH = route(async request => {
  const user = await requireUser(true);
  const data = await body(request, z.union([
    z.object({ templateId: idSchema, revision: revisionSchema, name: nameSchema, entries: templateEntriesSchema.optional() }).strict(),
    z.object({ templateId: idSchema, favorite: z.boolean() }).strict(),
  ]));
  const template = await db.$transaction(async tx => {
    const current = await tx.template.findUnique({ where: { id: data.templateId } });
    if (!current) throw new ApiError(404, "התבנית לא נמצאה");
    if ("favorite" in data) {
      if (data.favorite) await tx.templateFavorite.upsert({ where: { userId_templateId: { userId: user.id, templateId: data.templateId } }, create: { userId: user.id, templateId: data.templateId }, update: {} });
      else await tx.templateFavorite.deleteMany({ where: { userId: user.id, templateId: data.templateId } });
    } else {
      if (current.revision !== data.revision) throw stale();
      const shifts = data.entries ? createTemplateEntries(data.entries, current.sourceWeek) : undefined;
      const changed = await tx.template.updateMany({ where: { id: data.templateId, revision: data.revision }, data: { name: data.name, revision: { increment: 1 }, ...(shifts ? { shifts: asJson(shifts) } : {}) } });
      if (!changed.count) throw stale();
    }
    const updated = await tx.template.findUniqueOrThrow({ where: { id: data.templateId }, select });
    const favorite = await tx.templateFavorite.findUnique({ where: { userId_templateId: { userId: user.id, templateId: data.templateId } } });
    return { ...updated, favorite: !!favorite };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return json({ template });
});

export const DELETE = route(async request => {
  await requireUser(true);
  const data = await body(request, z.object({ templateId: idSchema, revision: revisionSchema }).strict());
  const deleted = await db.template.deleteMany({ where: { id: data.templateId, revision: data.revision } });
  if (!deleted.count) throw stale();
  return json({ deleted: true });
});
