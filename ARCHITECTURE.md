# Shared implementation contract

Next.js App Router + React + TypeScript, PostgreSQL and Prisma 6. `src/lib/types.ts` is the shared contract. All shift instants are ISO timestamps; civil dates and user input use Asia/Jerusalem. `weekStart` is a Sunday YYYY-MM-DD.

## Modules / ownership
- Backend agent: prisma schema/migrations/seed, src/lib/db.ts, auth.ts, validation.ts, weeks.ts, src/app/api/** except export, with PostgreSQL transactions and audit.
- Engine agent: src/lib/time.ts, scheduler.ts, tests/time.test.ts, scheduler.test.ts. Export functions below.
- UI agent: src/app/layout.tsx, page.tsx, login/**, globals.css, src/components/**, src/lib/utils.ts, public/**, manifest.ts. Do not edit types or package.
- Root: setup/config, export API, integration and browser tests, deployment/docs, integration fixes.

## HTTP contract
All APIs return JSON errors `{error:string, issues?:Issue[]}` and Cache-Control no-store. Mutation requests use JSON and check same origin; cookie session httpOnly.
- POST /api/auth/login {email,password} -> {user:SessionUser}; POST logout; GET /api/auth/me -> {user}.
- GET /api/weeks?week=YYYY-MM-DD -> WeekData. Admin sees draft; employee receives only published shifts and safe employee fields (id/name/groups/active; other Employee fields empty/default). No week -> empty schedule.
- PUT /api/weeks body {weekStart, revision, shifts} -> WeekData, optimistic concurrency 409. New week revision=0.
- POST /api/weeks/publish {weekStart,revision} -> WeekData; atomic publication, validation errors block; unfilled warning does not block.
- POST /api/weeks/auto {weekStart,revision} -> WeekData; creates draft only.
- POST /api/weeks/copy {weekStart,revision,sourceWeek} -> WeekData; copy source draft shifted by civil days, replace target only after UI confirmation.
- POST /api/weeks/undo {weekStart,revision} -> WeekData; restore previous snapshot as new revision.
- GET /api/employees -> {employees:Employee[]}; POST /api/employees {employee:Omit<Employee,'id'>,password?:string} -> {employee}; PUT /api/employees/[id] {employee:Employee} -> {employee}. Password on creation optionally grants employee login.
- GET /api/settings -> {rules}; PUT /api/settings {rules} -> {rules}.
- GET /api/templates -> {templates}; POST /api/templates {name,weekStart} -> {template}; POST /api/templates/apply {templateId,weekStart,revision} -> WeekData.
- GET /api/history?week=YYYY-MM-DD -> {history:[{id,action,createdAt,actorName,revision}]} admin only.
- GET /api/export?week=YYYY-MM-DD&version=draft|published -> xlsx admin only.

## Engine exports
`TIME_ZONE`, `today():string`, `weekStart(date?:string):string`, `addDays(date:string,days:number):string`, `localToISO(date:string,time:string,disambiguation?:'earlier'|'later'|'reject'):string`, `localDate(iso:string):string`, `localTime(iso:string):string`, `shiftByDays(shift:Shift,days:number):Shift`, `weekDates(week:string):string[]`.
`DEFAULT_RULES:Rules`, `validateSchedule(shifts:Shift[],employees:Employee[],rules:Rules,context?:Shift[]):Issue[]`, `getCandidates(shift:Shift,shifts:Shift[],employees:Employee[],rules:Rules,context?:Shift[]):{employee:Employee;eligible:boolean;reasons:string[];hours:number}[]`, `autoSchedule(shifts:Shift[],employees:Employee[],rules:Rules,context?:Shift[]):{shifts:Shift[];issues:Issue[]}`. Context contains neighboring weeks for boundary rest/overlap/hour validation; do not count shifts twice.
