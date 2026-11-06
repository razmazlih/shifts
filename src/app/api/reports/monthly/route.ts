import { requireUser } from "@/lib/auth";
import { currentMonth, getMonthlyReport, monthSchema } from "@/lib/monthly-report";
import { json, route } from "@/lib/validation";

export const GET = route(async (request) => {
  const user = await requireUser();
  const month = monthSchema.parse(new URL(request.url).searchParams.get("month") ?? currentMonth());
  return json(await getMonthlyReport(month, user));
});
