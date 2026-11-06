import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, route, weekSchema } from "@/lib/validation";
export const GET = route(async (request) => {
  await requireUser(true);
  const week = weekSchema.parse(new URL(request.url).searchParams.get("week"));
  const rows = await db.audit.findMany({
    where: { weekStart: week },
    orderBy: { revision: "desc" },
    take: 100,
    include: { actor: { select: { name: true } } },
  });
  return json({
    history: rows.map((r) => ({
      id: r.id,
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      actorName: r.actor.name,
      revision: r.revision,
    })),
  });
});
