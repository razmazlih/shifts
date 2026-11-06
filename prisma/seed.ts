import { PrismaClient, Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { addDays, localToISO, weekStart } from "../src/lib/time";
import { DEFAULT_RULES, validateSchedule } from "../src/lib/scheduler";
import type { Employee, Shift } from "../src/lib/types";
import { DEMO_ROSTER, demoAssignees } from "./demo-roster";
if (existsSync(".env")) process.loadEnvFile(".env");
const db = new PrismaClient();
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function main() {
  if (process.env.SEED_DEMO !== "true") {
    console.log("Demo seed skipped: SEED_DEMO must be true.");
    return;
  }
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
  const employeePassword = process.env.DEMO_EMPLOYEE_PASSWORD;
  for (const password of [adminPassword, employeePassword])
    if (
      !password ||
      password.length < 12 ||
      Buffer.byteLength(password) > 72 ||
      password.startsWith("replace-")
    )
      throw new Error(
        "Set distinct strong DEMO_ADMIN_PASSWORD and DEMO_EMPLOYEE_PASSWORD values of 12–72 bytes.",
      );
  if (adminPassword === employeePassword)
    throw new Error("Demo admin and employee passwords must be distinct.");
  const [adminHash, employeeHash] = await Promise.all([
    hash(adminPassword!, 12),
    hash(employeePassword!, 12),
  ]);
  await db.$transaction(
    async (tx) => {
      if (
        (await tx.user.count()) ||
        (await tx.employee.count()) ||
        (await tx.week.count())
      ) {
        console.log(
          "Database already contains data; seed leaves it unchanged.",
        );
        return;
      }
      const people: Employee[] = [];
      for (const [index, { name, groups }] of DEMO_ROSTER.entries()) {
        const employee = await tx.employee.create({
          data: {
            name,
            email:
              index === 0
                ? "employee@demo.local"
                : `staff${index + 1}@demo.local`,
            active: true,
            groups,
            maxWeeklyHours: 42,
            availability: [],
            timeOff: [],
            preferredDays: [index % 7, (index + 2) % 7],
          },
        });
        people.push({
          ...employee,
          groups: employee.groups as Employee["groups"],
          availability: [],
          timeOff: [],
          email: employee.email ?? undefined,
        });
      }
      const admin = await tx.user.create({
        data: {
          email: "admin@demo.local",
          name: "מנהל הדגמה",
          passwordHash: adminHash,
          role: "ADMIN",
        },
      });
      await tx.user.create({
        data: {
          email: "employee@demo.local",
          name: people[0].name,
          passwordHash: employeeHash,
          role: "EMPLOYEE",
          employeeId: people[0].id,
        },
      });
      await tx.settings.create({
        data: { id: "global", rules: json(DEFAULT_RULES) },
      });
      const current = weekStart();
      const schedules: { week: string; shifts: Shift[] }[] = [];
      for (const offset of [-7, 0, 7]) {
        const week = addDays(current, offset);
        const shifts: Shift[] = [];
        for (let day = 0; day < 7; day++) {
          const date = addDays(week, day);
          for (const group of ["MANAGERS", "PATROL"] as const) {
            for (const night of [false, true]) {
              const start = localToISO(date, night ? "22:00" : "07:00");
              const end = localToISO(
                night ? addDays(date, 1) : date,
                night ? "06:00" : day % 3 === 0 ? "16:00" : "15:00",
              );
              const count = group === "PATROL" ? 2 : 1;
              const assigned = demoAssignees(people, date, group, night);
              shifts.push({
                id: randomUUID(),
                title: `${night ? "לילה" : "בוקר"} · ${group === "MANAGERS" ? "אחמ״ש" : "סיור"}`,
                group,
                start,
                end,
                required: count,
                assignments: assigned.map((p) => ({
                  employeeId: p.id,
                  start,
                  end,
                })),
              });
            }
          }
        }
        schedules.push({ week, shifts });
      }
      for (const schedule of schedules) {
        const issues = validateSchedule(
          schedule.shifts,
          people,
          DEFAULT_RULES,
          schedules.filter((s) => s !== schedule).flatMap((s) => s.shifts),
        );
        if (issues.some((i) => i.severity === "error"))
          throw new Error(
            `Seed schedule validation failed: ${JSON.stringify(issues)}`,
          );
        await tx.week.create({
          data: {
            weekStart: schedule.week,
            revision: 1,
            shifts: json(schedule.shifts),
            publishedRevision: 1,
            publishedAt: new Date(),
          },
        });
        await tx.publication.create({
          data: {
            weekStart: schedule.week,
            revision: 1,
            shifts: json(schedule.shifts),
            actorId: admin.id,
          },
        });
        await tx.audit.create({
          data: {
            weekStart: schedule.week,
            revision: 1,
            action: "SEED",
            beforeShifts: [],
            afterShifts: json(schedule.shifts),
            actorId: admin.id,
          },
        });
      }
      const currentSchedule = schedules.find((s) => s.week === current)!;
      const draft: Shift[] = structuredClone(currentSchedule.shifts);
      const first = draft[0];
      draft.push({
        ...structuredClone(first),
        id: randomUUID(),
        title: "תגבור אירוע · דורש תיקון שיבוץ",
        note: "נתוני הדגמה בלבד: שיבוץ חופף מכוון לצורך הצגת ההתראה.",
      });
      // Include one unfilled role as a non-blocking staffing warning.
      draft.at(-2)!.assignments = [];
      await tx.week.update({
        where: { weekStart: current },
        data: { revision: 2, shifts: json(draft) },
      });
      await tx.audit.create({
        data: {
          weekStart: current,
          revision: 2,
          action: "SAVE",
          beforeShifts: json(currentSchedule.shifts),
          afterShifts: json(draft),
          actorId: admin.id,
        },
      });
      await tx.template.create({
        data: {
          name: "שבוע בסיס · בוקר ולילה",
          sourceWeek: current,
          shifts: json(
            currentSchedule.shifts.map((s) => ({ ...s, assignments: [] })),
          ),
        },
      });
      console.log(
        `Created ${DEMO_ROSTER.length} demo employees and three full weeks around ${current}. Current published version is valid; current draft includes a deliberate conflict.`,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    },
  );
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
