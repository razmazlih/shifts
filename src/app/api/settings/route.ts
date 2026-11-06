import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, body, json, route, rulesSchema } from "@/lib/validation";
import { asJson, getRules } from "@/lib/weeks";
export const GET = route(async () => {
  await requireUser(true);
  return json({ rules: await getRules() });
});
export const PUT = route(async (request) => {
  await requireUser(true);
  const { rules, expectedRules } = await body(
    request,
    z.object({ rules: rulesSchema, expectedRules: rulesSchema }).strict(),
  );
  await db.$transaction(async tx => {
    const current = await getRules(tx);
    if (current.minRestHours !== expectedRules.minRestHours || current.maxShiftHours !== expectedRules.maxShiftHours || current.defaultMaxWeeklyHours !== expectedRules.defaultMaxWeeklyHours)
      throw new ApiError(409, "כללי השיבוץ השתנו מאז הטעינה. ההגדרות לא נשמרו; יש לרענן לפני ניסיון נוסף.");
    await tx.settings.upsert({
      where: { id: "global" },
      create: { id: "global", rules: asJson(rules) },
      update: { rules: asJson(rules) },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return json({ rules });
});
