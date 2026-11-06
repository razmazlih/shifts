import { compare } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { consumeLoginAttempt, createSession, destroySession } from "@/lib/auth";
import { ApiError, body, json, route } from "@/lib/validation";
const schema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z
      .string()
      .min(1)
      .max(72)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
  })
  .strict();
// A fixed valid hash keeps unknown-account authentication on the same bcrypt path.
const dummyHash =
  "$2b$12$4ZmjP6Dap9N4hUk5pS1f/O7EvoLTo3g0GJTTdnmeYq2qit36FqV6m";
export const POST = route(async (request) => {
  const { email, password } = await body(request, schema);
  await consumeLoginAttempt(email);
  const user = await db.user.findUnique({
    where: { email },
    include: { employee: true },
  });
  const valid = await compare(password, user?.passwordHash ?? dummyHash);
  if (!user || !valid || (user.role === "EMPLOYEE" && !user.employee?.active))
    throw new ApiError(401, "כתובת הדוא״ל או הסיסמה שגויים");
  await destroySession();
  await createSession(user.id);
  return json({
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      employeeId: user.employeeId,
    },
  });
});
