import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { body, idSchema, json, route, schedulingRequestSchema } from "@/lib/validation";
import { cancelSchedulingProposal, createSchedulingProposal } from "@/lib/schedule-proposals";
export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(request, schedulingRequestSchema);
  return json(await createSchedulingProposal(user, data));
});
export const DELETE = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(request, z.object({ proposalId: idSchema }).strict());
  return json(await cancelSchedulingProposal(user, data.proposalId));
});
