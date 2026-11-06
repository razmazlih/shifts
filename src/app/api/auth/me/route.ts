import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/validation";
export const GET = route(async () => json({ user: await requireUser() }));
