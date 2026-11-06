import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { body, idSchema, json, route } from "@/lib/validation";
import { listPersonalUpdates, markPersonalUpdate } from "@/lib/publication-notifications";
export const GET = route(async request => {
  const user = await requireUser();
  const query = z.object({ cursor: idSchema.optional() }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await listPersonalUpdates(user, query.cursor));
});
export const PATCH = route(async request => {
  const user = await requireUser();
  const data = await body(request, z.object({ id: idSchema, action: z.enum(["open", "acknowledge"]) }).strict());
  return json({ update: await markPersonalUpdate(user, data.id, data.action) });
});
