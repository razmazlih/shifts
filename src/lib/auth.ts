import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { ApiError } from "./validation";
import type { SessionUser } from "./types";
export const SESSION_COOKIE = "mishmeret_session";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { employee: true } } },
  });
  if (
    !session ||
    session.expiresAt <= new Date() ||
    (session.user.role === "EMPLOYEE" && !session.user.employee?.active)
  )
    return null;
  const { id, name, role, employeeId } = session.user;
  return { id, name, role, employeeId };
}
export async function requireUser(admin = false): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "נדרשת התחברות");
  if (admin && user.role !== "ADMIN")
    throw new ApiError(403, "הפעולה מותרת למנהל בלבד");
  return user;
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}
export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token)
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}
// A database-atomic account bucket and global bucket do not depend on spoofable proxy headers.
export async function consumeLoginAttempt(email: string) {
  const windowStart = new Date(Date.now() - 15 * 60 * 1000);
  for (const [key, limit] of [
    ["global", 300],
    [`email:${hashToken(email)}`, 10],
  ] as const) {
    const rows = await db.$queryRaw<{ attempts: number }[]>`
      INSERT INTO "LoginAttempt" ("key", "attempts", "windowStart") VALUES (${key}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE WHEN "LoginAttempt"."windowStart" < ${windowStart} THEN 1 ELSE "LoginAttempt"."attempts" + 1 END,
        "windowStart" = CASE WHEN "LoginAttempt"."windowStart" < ${windowStart} THEN NOW() ELSE "LoginAttempt"."windowStart" END
      RETURNING "attempts"`;
    if (rows[0].attempts > limit)
      throw new ApiError(
        429,
        "יותר מדי ניסיונות התחברות. נסו שוב בעוד 15 דקות.",
      );
  }
}
