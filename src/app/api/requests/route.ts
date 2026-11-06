import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { body, idSchema, json, route } from "@/lib/validation";
import { createEmployeeRequest, decideEmployeeRequest, listEmployeeRequests } from "@/lib/employee-requests";

const instant = z.string().datetime({ offset: true }).max(40);
const createSchema = z.object({
  submissionKey: z.string().uuid(), kind: z.enum(["ABSENCE", "CONSTRAINT"]),
  start: instant, end: instant, reason: z.string().trim().max(500).default(""),
}).strict().refine(value => Date.parse(value.end) > Date.parse(value.start) && Date.parse(value.end) - Date.parse(value.start) <= 366 * 24 * 3600000,
  "יש לבחור טווח חיובי שאינו ארוך משנה");

export const GET = route(async request => {
  const user = await requireUser();
  const rawId = new URL(request.url).searchParams.get("id");
  const id = rawId === null ? undefined : idSchema.parse(rawId);
  const params = new URL(request.url).searchParams;
  const cursor = params.has("cursor") ? idSchema.parse(params.get("cursor")) : undefined;
  const status = params.has("status") ? z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ALL"]).parse(params.get("status")) : undefined;
  return json(await listEmployeeRequests(user, { id, cursor, status }));
});
export const POST = route(async request => {
  const user = await requireUser();
  const input = await body(request, createSchema);
  return json({ request: await createEmployeeRequest(user, input) }, 201);
});
export const PATCH = route(async request => {
  const user = await requireUser();
  const input = await body(request, z.object({
    id: idSchema, revision: z.number().int().nonnegative(), action: z.enum(["approve", "reject", "cancel"]), decisionNote: z.string().trim().max(1000).default(""),
  }).strict());
  return json({ request: await decideEmployeeRequest(user, input.id, input.revision, input.action, input.decisionNote) });
});
