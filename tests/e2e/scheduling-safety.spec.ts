import { test, expect, request as requestFactory, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { addDays, localToISO, weekStart } from "../../src/lib/time";
import type { Employee, SchedulingProposal, SchedulingScope, Shift, WeekData } from "../../src/lib/types";
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const scope: SchedulingScope = { days: [0], groups: ["PATROL"] };
let admin: APIRequestContext, worker: APIRequestContext, person: Employee;
let date = weekStart("2035-03-04"), index = 0;
const payload = (data: unknown) => ({ data, headers: { Origin: baseURL } });
async function ok<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json() as Promise<T>;
}
const read = (day = date) => admin.get(`/api/weeks?week=${day}`).then(ok<WeekData>);
const makeShift = (day = date, group: Shift["group"] = "PATROL", assignments = true): Shift => {
  const start = localToISO(day, "08:00"), end = localToISO(day, "16:00");
  return { id: randomUUID(), title: "משמרת בדיקת בטיחות", group, start, end, required: 1,
    assignments: assignments ? [{ employeeId: person.id, start, end }] : [] };
};
async function save(shifts: Shift[], day = date) {
  const current = await read(day);
  return ok<WeekData>(await admin.put("/api/weeks", payload({ weekStart: day, revision: current.revision, shifts })));
}
async function preview(mode = "fill", selected = scope, extra = {}) {
  const current = await read();
  return ok<SchedulingProposal>(await admin.post("/api/weeks/auto", payload({ weekStart: date, revision: current.revision, scope: selected, mode, ...extra })));
}
const apply = (proposal: SchedulingProposal) => admin.post("/api/weeks/auto/apply", payload({ proposalId: proposal.id }));
test.beforeAll(async () => {
  admin = await requestFactory.newContext({ baseURL }); worker = await requestFactory.newContext({ baseURL });
  await ok(await admin.post("/api/auth/login", payload({ email: "admin@demo.local", password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026" })));
  await ok(await worker.post("/api/auth/login", payload({ email: "employee@demo.local", password: process.env.DEMO_EMPLOYEE_PASSWORD ?? "DemoWorker!2026" })));
  const created = await ok<{ employee: Employee }>(await admin.post("/api/employees", payload({ employee: {
    name: "עובד בדיקות בטיחות", active: true, groups: ["PATROL", "MANAGERS"], maxWeeklyHours: 168,
    availability: [], timeOff: [], preferredDays: [],
  } })));
  person = created.employee;
});
test.beforeEach(() => { date = addDays(weekStart("2035-03-04"), 21 * index++); });
test.afterAll(async () => {
  if (person) await admin.put(`/api/employees/${person.id}`, payload({ employee: { ...person, active: false } }));
  await admin?.dispose(); await worker?.dispose();
});

test("fill changes only selected day/team; preview is read-only and apply saves exactly reviewed records", async () => {
  const otherTeam = makeShift(), target = makeShift(date, "PATROL", false), otherDay = makeShift(addDays(date, 1), "PATROL", false);
  otherTeam.group = "MANAGERS";
  const before = await save([otherTeam, target, otherDay]);
  const proposal = await preview();
  expect(proposal.shifts[0]).toEqual(otherTeam); expect(proposal.shifts[2]).toEqual(otherDay);
  expect(proposal.shifts[1].assignments.length).toBeGreaterThan(0);
  expect(proposal.shifts[1].assignments.every((a) => a.employeeId !== person.id)).toBe(true);
  const unchanged = await read(); expect(unchanged.shifts).toEqual(before.shifts); expect(unchanged.revision).toBe(before.revision);
  const after = await ok<WeekData>(await apply(proposal));
  expect(after.shifts).toEqual(proposal.shifts); expect(after.revision).toBe(before.revision + 1);
  expect(after.publishedRevision).toBe(before.publishedRevision);
  expect((await apply(proposal)).status()).toBe(409);
});

test("fill retains partial existing segments and existing errors; repair respects locks", async () => {
  const locked = makeShift(); locked.assignments[0].locked = true;
  const overlap = { ...makeShift(), start: localToISO(date, "12:00"), end: localToISO(date, "20:00") };
  overlap.assignments = [{ employeeId: person.id, start: overlap.start, end: overlap.end }];
  const partial = makeShift(addDays(date, 1)); partial.required = 2; partial.assignments[0].end = localToISO(addDays(date, 1), "12:00");
  await save([locked, overlap, partial]);
  const fill = await preview("fill", { ...scope, days: [0, 1] });
  expect(fill.shifts[0]).toEqual(locked); expect(fill.shifts[1]).toEqual(overlap);
  expect(fill.shifts[2].assignments[0]).toEqual(partial.assignments[0]);
  expect(fill.issues.some((issue) => issue.code === "OVERLAP")).toBe(true);
  const repair = await preview("repair");
  expect(repair.shifts[0]).toEqual(locked); expect(repair.shifts[2]).toEqual(partial);
  expect(repair.shifts[1].assignments.some((a) => a.employeeId === person.id)).toBe(false);
  expect((await ok<WeekData>(await apply(repair))).shifts[0]).toEqual(locked);
});

test("cancel preserves revision, draft, publication and audit history", async () => {
  const before = await save([makeShift(date, "PATROL", false)]);
  const historyBefore = await ok(await admin.get(`/api/history?week=${date}`));
  const proposal = await preview();
  await ok(await admin.delete("/api/weeks/auto", payload({ proposalId: proposal.id })));
  expect((await apply(proposal)).status()).toBe(409);
  expect(await read()).toEqual(before);
  expect(await ok(await admin.get(`/api/history?week=${date}`))).toEqual(historyBefore);
});

test("stale revision rejects apply and two simultaneous apply requests never overwrite", async () => {
  const original = makeShift(date, "PATROL", false); await save([original]);
  const stale = await preview(); const changed = await save([{ ...original, title: "עריכה מקבילה" }]);
  expect((await apply(stale)).status()).toBe(409); expect((await read()).shifts).toEqual(changed.shifts);
  const fresh = await preview(); const results = await Promise.all([apply(fresh), apply(fresh)]);
  expect(results.map((result) => result.status()).sort()).toEqual([200, 409]);
  expect((await read()).shifts).toEqual(fresh.shifts);
});

test("availability, rules and neighboring commitments each invalidate a reviewed proposal", async () => {
  await save([makeShift(date, "PATROL", false)]);
  const before = await read();
  const availabilityProposal = await preview();
  await ok(await admin.put(`/api/employees/${person.id}`, payload({ employee: { ...person, timeOff: [{ start: localToISO(date, "08:00"), end: localToISO(date, "16:00") }] } })));
  expect((await apply(availabilityProposal)).status()).toBe(409);
  await ok(await admin.put(`/api/employees/${person.id}`, payload({ employee: person })));
  const rulesProposal = await preview();
  await ok(await admin.put("/api/settings", payload({ rules: { ...before.rules, minRestHours: before.rules.minRestHours === 8 ? 9 : 8 } })));
  expect((await apply(rulesProposal)).status()).toBe(409);
  await ok(await admin.put("/api/settings", payload({ rules: before.rules })));
  const neighborProposal = await preview(); const previous = addDays(date, -7);
  await save([makeShift(previous)], previous);
  expect((await apply(neighborProposal)).status()).toBe(409);
  expect((await read()).shifts).toEqual(before.shifts);
});

test("daily-template scheduling leaves other days and teams untouched", async () => {
  const otherDay = makeShift(), otherTeam = makeShift(addDays(date, 1), "MANAGERS");
  await save([otherDay, otherTeam]);
  const { template } = await ok<{ template: { id: string } }>(await admin.post("/api/templates", payload({
    name: "תבנית יומית לבטיחות", weekStart: date,
    entries: [{ title: "סיור יומי", group: "PATROL", startTime: "08:00", endTime: "16:00", required: 1, days: [0] }],
  })));
  try {
    const current = await read();
    const proposal = await ok<SchedulingProposal>(await admin.post("/api/templates/apply", payload({
      weekStart: date, revision: current.revision, templateId: template.id, targetDay: 1, autoSchedule: true,
      scope: { days: [1], groups: ["PATROL"] },
    })));
    expect(proposal.shifts).toContainEqual(otherDay); expect(proposal.shifts).toContainEqual(otherTeam);
    expect((await read()).shifts).toEqual(current.shifts);
    expect((await ok<WeekData>(await apply(proposal))).shifts).toEqual(proposal.shifts);
  } finally { await admin.delete("/api/templates", payload({ templateId: template.id })); }
});

test("employee cannot create/apply/cancel proposals and publish blockers cannot be overridden", async () => {
  const original = makeShift(), duplicate = { ...original, id: randomUUID() };
  const before = await save([original, duplicate]);
  for (const path of ["/api/weeks/auto", "/api/weeks/auto/apply"])
    expect((await worker.post(path, payload({}))).status()).toBe(403);
  expect((await worker.delete("/api/weeks/auto", payload({ proposalId: "unknown" }))).status()).toBe(403);
  const review = await ok<{ reviewToken: string }>(await admin.get(`/api/weeks/publish?week=${date}`));
  const response = await admin.post("/api/weeks/publish", payload({ weekStart: date, revision: before.revision, reviewToken: review.reviewToken, allowUnderstaffed: true }));
  expect(response.status()).toBe(422);
  expect((await read()).publishedRevision).toBe(before.publishedRevision);
});
