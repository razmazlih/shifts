import { requireUser } from "@/lib/auth";
import {
  body,
  json,
  route,
  weekSchema,
  revisionSchema,
  shiftsSchema,
} from "@/lib/validation";
import { getWeekData, mutateWeek } from "@/lib/weeks";
import { weekStart } from "@/lib/time";
export const GET = route(async (request) => {
  const user = await requireUser();
  const week = weekSchema.parse(
    new URL(request.url).searchParams.get("week") ?? weekStart(),
  );
  return json(await getWeekData(week, user));
});
export const PUT = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(
    request,
    revisionSchema.extend({ shifts: shiftsSchema }),
  );
  return json(
    await mutateWeek(
      user,
      data.weekStart,
      data.revision,
      "SAVE",
      async () => data.shifts,
    ),
  );
});
