import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { personalSchedule } from "@/lib/personal-schedule";
import { addDays, localDate, weekStart } from "@/lib/time";
import { ApiError, json, route } from "@/lib/validation";

export const GET = route(async () => {
  const user = await requireUser();
  if (!user.employeeId) throw new ApiError(403, "המסך האישי זמין לחשבון עובד מקושר בלבד");
  const now = new Date();
  // Include the previous week for a Saturday-night assignment continuing Sunday.
  // No upper horizon: the next assignment can be in any available published week.
  const weeks = await db.week.findMany({
    where: { weekStart: { gte: addDays(weekStart(localDate(now.toISOString())), -7) } },
    orderBy: { weekStart: "asc" },
    select: {
      weekStart: true,
      publications: {
        orderBy: { revision: "desc" },
        take: 1,
        select: { shifts: true },
      },
    },
  });
  return json(personalSchedule(weeks, user.employeeId, now));
});
