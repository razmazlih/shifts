import { Prisma, PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { DEMO_ROSTER, demoAssignees } from "../prisma/demo-roster";
import { localDate, localTime } from "../src/lib/time";
import { DEFAULT_RULES, validateSchedule } from "../src/lib/scheduler";
import type { Employee, Shift, Rules } from "../src/lib/types";

async function main() {
  const envFile = process.argv[2];
  if (!envFile) throw new Error("Usage: tsx scripts/update-demo-roster.ts ENV_FILE [--apply]");
  const env = parseEnv(readFileSync(envFile, "utf8"));
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
  try {
    await db.$transaction(async (tx) => {
      const employees = await tx.employee.findMany();
      const weeks = await tx.week.findMany({ orderBy: { weekStart: "asc" } });
      const publications = await tx.publication.findMany();
      const users = await tx.user.findMany({ select: { id: true, email: true, name: true, employeeId: true, role: true } });
      const admin = users.find(u => u.email === "admin@demo.local" && u.role === "ADMIN");
      if (!admin || employees.some(e => !/^(employee|staff\d+)@demo\.local$/.test(e.email ?? "")) || ![12,15].includes(employees.length))
        throw new Error("Not a recognized demo database; no changes made.");
      const originalNames = ["נועה לוי", "איתי כהן", "מאיה ישראלי", "עומר דוד", "שירה מזרחי", "יובל פרץ", "תמר אברהם", "אדם ביטון", "רוני ברק", "דניאל גולן", "יעל שחר", "אורי רז"];
      const people: Employee[] = DEMO_ROSTER.map((entry, index) => {
        const email = index === 0 ? "employee@demo.local" : `staff${index+1}@demo.local`;
        const existing = employees.find(e => e.email === email);
        if (existing && existing.name !== originalNames[index] && existing.name !== entry.name)
          throw new Error(`Unexpected demo employee at ${email}; no changes made.`);
        return { ...existing, id: existing?.id ?? `demo-roster-${index+1}`, ...entry, email, active: true,
          maxWeeklyHours: existing?.maxWeeklyHours ?? 42, availability: (existing?.availability ?? []) as unknown as Employee["availability"],
          timeOff: (existing?.timeOff ?? []) as unknown as Employee["timeOff"], preferredDays: existing?.preferredDays ?? [index%7,(index+2)%7] };
      });
      const rewrite = (value: unknown): Shift[] => (value as Shift[]).map(s => {
        if (!s.assignments.length) return s;
        const assigned = demoAssignees(people, localDate(s.start), s.group, localTime(s.start) === "22:00");
        return { ...s, assignments: assigned.map(p => ({employeeId:p.id,start:s.start,end:s.end})) };
      });
      const planned = weeks.map(w => {
        const pub = publications.find(p => p.weekStart === w.weekStart && p.revision === w.publishedRevision);
        if (!pub) throw new Error("Expected published demo week");
        return { week:w, published:rewrite(pub.shifts), draft:rewrite(w.shifts) };
      });
      const rules = ((await tx.settings.findUnique({where:{id:"global"}}))?.rules ?? DEFAULT_RULES) as unknown as Rules;
      for (const p of planned) {
        const errors = validateSchedule(p.published,people,rules,planned.filter(other=>other!==p).flatMap(other=>other.published)).filter(i=>i.severity==="error");
        if(errors.length) throw new Error(JSON.stringify(errors));
      }
      const represented = new Set(planned.flatMap(p=>p.published.flatMap(s=>s.assignments.map(a=>a.employeeId))));
      if (people.some(p=>!represented.has(p.id))) throw new Error("Roster missing from schedules");
      console.log(JSON.stringify({employees:people.map(p=>({name:p.name,groups:p.groups})),weeks:planned.length,scheduledEmployees:represented.size,mode:process.argv.includes("--apply")?"apply":"preview"}));
      if (!process.argv.includes("--apply")) return;
      writeFileSync(`.local/demo-roster-backup-${Date.now()}.json`,JSON.stringify({employees,weeks,publications,users},null,2),{mode:0o600});
      for (const p of people) {
        const data={name:p.name,groups:p.groups};
        if (employees.some(e=>e.id===p.id)) await tx.employee.update({where:{id:p.id},data});
        else await tx.employee.create({data:{...p,availability:json(p.availability),timeOff:json(p.timeOff)}});
        await tx.user.updateMany({where:{employeeId:p.id},data:{name:p.name}});
      }
      for (const p of planned) {
        const publishedRevision = p.week.revision+1;
        const hasDraft = p.week.revision !== p.week.publishedRevision;
        const revision = publishedRevision+(hasDraft?1:0);
        await tx.publication.create({data:{weekStart:p.week.weekStart,revision:publishedRevision,shifts:json(p.published),actorId:admin.id}});
        await tx.week.update({where:{weekStart:p.week.weekStart},data:{revision,publishedRevision,publishedAt:new Date(),shifts:json(hasDraft?p.draft:p.published)}});
        await tx.audit.create({data:{weekStart:p.week.weekStart,revision,action:"UPDATE_DEMO_ROSTER",beforeShifts:p.week.shifts as Prisma.InputJsonValue,afterShifts:json(hasDraft?p.draft:p.published),actorId:admin.id}});
      }
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
  } finally { await db.$disconnect(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
