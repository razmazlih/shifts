import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { body, idSchema, json, route } from "@/lib/validation";
import { applySchedulingProposal } from "@/lib/schedule-proposals";
export const POST = route(async (request) => {
  const user = await requireUser(true);
  const data = await body(request, z.object({ proposalId: idSchema }).strict());
  return json(await applySchedulingProposal(user, data.proposalId));
});
