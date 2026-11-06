import { requireUser } from "@/lib/auth";
import { z } from "zod";
import { ApiError, body, json, route, revisionSchema, weekSchema } from "@/lib/validation";
import { mutateWeek } from "@/lib/weeks";
import { getPublicationReview, publicationReview } from "@/lib/publication-review";
export const GET = route(async (request) => {
  const user = await requireUser(true);
  const week = weekSchema.parse(new URL(request.url).searchParams.get("week"));
  return json(await getPublicationReview(week, user));
});
export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(request, revisionSchema.extend({
    reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
    allowUnderstaffed: z.boolean().default(false),
  }));
  return json(
    await mutateWeek(
      user,
      data.weekStart,
      data.revision,
      "PUBLISH",
      async (shifts, tx) => {
        const review = await publicationReview(data.weekStart, user, tx);
        if (review.reviewToken !== data.reviewToken)
          throw new ApiError(409, "הסידור או האילוצים השתנו מאז הבדיקה. יש לפתוח מחדש את הבדיקה לפני פרסום.");
        return shifts;
      },
      true,
      { allowUnderstaffed: data.allowUnderstaffed },
    ),
  );
});
