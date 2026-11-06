import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: unknown[],
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function route(fn: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await fn(request);
    } catch (error) {
      if (error instanceof ApiError)
        return json(
          {
            error: error.message,
            ...(error.issues ? { issues: error.issues } : {}),
          },
          error.status,
        );
      if (error instanceof z.ZodError)
        return json(
          {
            error: "הנתונים שנשלחו אינם תקינים",
            issues: error.issues.map((i) => ({
              message: i.message,
              path: i.path.join("."),
            })),
          },
          400,
        );
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (["P2034", "P2002"].includes(error.code))
          return json(
            {
              error: "הנתונים השתנו או שהרשומה כבר קיימת. יש לרענן ולנסות שוב.",
            },
            409,
          );
        if (error.code === "P2025")
          return json({ error: "הרשומה לא נמצאה" }, 404);
      }
      console.error(
        "API request failed",
        error instanceof Error ? error.message : "unknown",
      );
      return json({ error: "אירעה שגיאה בשרת. נסו שוב מאוחר יותר." }, 500);
    }
  };
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : new URL(request.url).origin;
  if (
    !origin ||
    origin !== expected ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(403, "הבקשה אינה מורשית ממקור זה");
}
export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  checkOrigin(request);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ApiError(415, "נדרש תוכן JSON");
  const limit = 512 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new ApiError(413, "הבקשה גדולה מדי");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "חסר גוף בקשה");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(413, "הבקשה גדולה מדי");
    }
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "JSON לא תקין");
  }
  return schema.parse(parsed);
}
export const idSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return (
      Number.isFinite(d.getTime()) &&
      d.toISOString().slice(0, 10) === v &&
      +v.slice(0, 4) >= 2000 &&
      +v.slice(0, 4) <= 2100
    );
  }, "תאריך לא תקין");
export const weekSchema = dateSchema.refine(
  (v) => new Date(v + "T00:00:00Z").getUTCDay() === 0,
  "השבוע צריך להתחיל ביום ראשון",
);
const instant = z.string().datetime({ offset: true }).max(40);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const group = z.enum(["MANAGERS", "PATROL"]);
export const shiftSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(120),
    group,
    start: instant,
    end: instant,
    required: z.number().int().min(1).max(50),
    note: z.string().max(1000).optional(),
    assignments: z
      .array(
        z
          .object({ employeeId: idSchema, start: instant, end: instant, locked: z.boolean().optional() })
          .strict()
          .refine(
            (v) =>
              Date.parse(v.end) > Date.parse(v.start) &&
              Date.parse(v.end) - Date.parse(v.start) <= 48 * 3600000,
            "טווח שיבוץ חייב להיות חיובי ולא לעלות על 48 שעות",
          ),
      )
      .max(2400),
  })
  .strict();
export const shiftsSchema = z
  .array(shiftSchema)
  .max(300)
  .refine(
    (v) => new Set(v.map((s) => s.id)).size === v.length,
    "מזהי המשמרות צריכים להיות ייחודיים",
  );
export const employeeFields = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .union([
        z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        z.literal(""),
      ])
      .optional(),
    active: z.boolean(),
    groups: z
      .array(group)
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
    maxWeeklyHours: z.number().min(1).max(168),
    availability: z
      .array(
        z
          .object({
            day: z.number().int().min(0).max(6),
            start: clock,
            end: clock,
          })
          .strict()
          .refine(
            (v) => v.end !== v.start,
            "שעת התחלה וסיום חייבות להיות שונות",
          ),
      )
      .max(70),
    timeOff: z
      .array(
        z
          .object({
            start: instant,
            end: instant,
            reason: z.string().max(500).optional(),
            requestId: idSchema.optional(),
          })
          .strict()
          .refine(
            (v) => Date.parse(v.end) > Date.parse(v.start),
            "טווח היעדרות לא תקין",
          ),
      )
      .max(100),
    preferredDays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export const rulesSchema = z
  .object({
    minRestHours: z.number().min(0).max(48),
    maxShiftHours: z.number().min(1).max(24),
    defaultMaxWeeklyHours: z.number().min(1).max(168),
  })
  .strict();
export const revisionSchema = z
  .object({
    weekStart: weekSchema,
    revision: z.number().int().nonnegative().max(2147483646),
  })
  .strict();
export const passwordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine((v) => Buffer.byteLength(v, "utf8") <= 72, "הסיסמה ארוכה מדי");

export const schedulingScopeSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, "יש לבחור כל יום פעם אחת"),
  groups: z.array(group).min(1).max(2)
    .refine((groups) => new Set(groups).size === groups.length, "יש לבחור כל צוות פעם אחת"),
}).strict();
export const schedulingRequestSchema = revisionSchema.extend({
  mode: z.enum(["fill", "repair"]).default("fill"),
  scope: schedulingScopeSchema,
  templateId: idSchema.optional(),
  templateRevision: z.number().int().nonnegative().max(2147483646).optional(),
});
