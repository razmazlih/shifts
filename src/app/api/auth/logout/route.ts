import { destroySession } from "@/lib/auth";
import { checkOrigin, json, route } from "@/lib/validation";
export const POST = route(async (request) => {
  checkOrigin(request);
  await destroySession();
  return json({ ok: true });
});
