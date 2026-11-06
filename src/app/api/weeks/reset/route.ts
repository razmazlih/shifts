import { requireUser } from "@/lib/auth";
import { body, json, route, revisionSchema } from "@/lib/validation";
import { mutateWeek } from "@/lib/weeks";

export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(request, revisionSchema);
  return json(
    await mutateWeek(
      user,
      data.weekStart,
      data.revision,
      "RESET",
      async () => [],
    ),
  );
});
