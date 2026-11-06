import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { z } from "zod";
const db = new PrismaClient();
async function main() {
  const email = z.string().email().parse(process.env.ADMIN_EMAIL).toLowerCase();
  const password = z.string().min(12).max(72).parse(process.env.ADMIN_PASSWORD);
  if (Buffer.byteLength(password) > 72)
    throw new Error("Password exceeds 72 UTF-8 bytes");
  const name = z
    .string()
    .min(1)
    .max(100)
    .parse(process.env.ADMIN_NAME ?? "מנהל הצוות");
  if (await db.user.findUnique({ where: { email } }))
    throw new Error("Account already exists; no account was changed");
  await db.user.create({
    data: {
      email,
      name,
      passwordHash: await hash(password, 12),
      role: "ADMIN",
    },
  });
  console.log("Administrator account created.");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
