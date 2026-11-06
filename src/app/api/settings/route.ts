import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { body, json, route, rulesSchema } from "@/lib/validation";
import { asJson, getRules } from "@/lib/weeks";
export const GET = route(async () => {
  await requireUser(true);
  return json({ rules: await getRules() });
});
export const PUT = route(async (request) => {
  await requireUser(true);
  const { rules } = await body(
    request,
    z.object({ rules: rulesSchema }).strict(),
  );
  await db.settings.upsert({
    where: { id: "global" },
    create: { id: "global", rules: asJson(rules) },
    update: { rules: asJson(rules) },
  });
  return json({ rules });
});
