import { requireUser } from "@/lib/auth";
import { body, json, route, revisionSchema } from "@/lib/validation";
import { autoWeek } from "@/lib/weeks";
export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(request, revisionSchema);
  return json(await autoWeek(user, data.weekStart, data.revision));
});
