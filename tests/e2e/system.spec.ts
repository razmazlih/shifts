import {
  test,
  expect,
  request as requestFactory,
  type APIRequestContext,
} from "@playwright/test";
import ExcelJS from "exceljs";
import { localToISO } from "../../src/lib/time";
import type { Employee, Shift, WeekData, SchedulingProposal } from "../../src/lib/types";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const week = "2030-06-02";
let admin: APIRequestContext;
let worker: APIRequestContext;
let employee: Employee;
const data = (value: unknown) => ({
  data: value,
  headers: { Origin: baseURL },
});
async function read(client: APIRequestContext, date = week): Promise<WeekData> {
  const r = await client.get(`/api/weeks?week=${date}`);
  expect(r.status()).toBe(200);
  return r.json();
}
async function save(shifts: Shift[], date = week) {
  const current = await read(admin, date);
  const r = await admin.put(
    "/api/weeks",
    data({ weekStart: date, revision: current.revision, shifts }),
  );
  expect(r.status(), await r.text()).toBe(200);
  return r.json() as Promise<WeekData>;
}
async function publish(date = week) {
  const w = await read(admin, date);
  const review = await (await admin.get(`/api/weeks/publish?week=${date}`)).json();
  const r = await admin.post(
    "/api/weeks/publish",
    data({ weekStart: date, revision: w.revision, reviewToken: review.reviewToken }),
  );
  expect(r.status(), await r.text()).toBe(200);
  return r.json() as Promise<WeekData>;
}
function shift(id = "integration-night", title = "סיור לילה לבדיקה"): Shift {
  const start = localToISO(week, "22:00"),
    end = localToISO("2030-06-03", "06:00");
  return {
    id,
    title,
    group: employee.groups[0],
    start,
    end,
    required: 1,
    note: "הערה ניהולית פרטית",
    assignments: [{ employeeId: employee.id, start, end }],
  };
}
test.beforeAll(async () => {
  admin = await requestFactory.newContext({ baseURL });
  worker = await requestFactory.newContext({ baseURL });
  for (const [client, email, password] of [
    [
      admin,
      "admin@demo.local",
      process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026",
    ],
    [
      worker,
      "employee@demo.local",
      process.env.DEMO_EMPLOYEE_PASSWORD ?? "DemoWorker!2026",
    ],
  ] as const) {
    const r = await client.post("/api/auth/login", data({ email, password }));
    expect(r.status(), await r.text()).toBe(200);
  }
  const me = await (await worker.get("/api/auth/me")).json();
  employee = (await read(admin)).employees.find(
    (e) => e.id === me.user.employeeId,
  )!;
  expect(employee).toBeTruthy();
});
test.afterAll(async () => {
  await admin?.dispose();
  await worker?.dispose();
});

test("draft stays private; atomic publication updates the employee and keeps previous snapshot", async () => {
  const original = shift();
  await save([original]);
  await publish();
  const before = await read(worker);
  expect(before.shifts[0].title).toBe(original.title);
  expect(before.shifts[0]).not.toHaveProperty("note");
  expect(
    before.employees.every(
      (e) => !e.email && e.timeOff.length === 0 && e.availability.length === 0,
    ),
  ).toBe(true);
  const updated = await save([{ ...original, title: "סיור לילה מעודכן" }]);
  expect(updated.hasDraft).toBe(true);
  expect((await read(worker)).shifts[0].title).toBe(original.title);
  const published = await publish();
  expect(published.hasDraft).toBe(false);
  expect((await read(worker)).shifts[0].title).toBe("סיור לילה מעודכן");
  expect((await read(worker)).hasDraft).toBe(false);
  const history = await (await admin.get(`/api/history?week=${week}`)).json();
  expect(
    history.history.filter((h: { action: string }) => h.action === "PUBLISH")
      .length,
  ).toBeGreaterThanOrEqual(2);
});
test("all management mutations, drafts, history and Excel enforce server roles", async () => {
  const w = await read(worker);
  for (const path of ["/api/weeks", "/api/settings"]) {
    const r = await worker.put(
      path,
      data({ weekStart: week, revision: w.revision, shifts: [] }),
    );
    expect(r.status()).toBe(403);
  }
  for (const path of [
    "/api/weeks/publish",
    "/api/weeks/auto",
    "/api/weeks/undo",
    "/api/weeks/reset",
    "/api/weeks/copy",
    "/api/templates",
    "/api/templates/apply",
    "/api/employees",
  ]) {
    expect((await worker.post(path, data({}))).status()).toBe(403);
  }
  expect(
    (await worker.put(`/api/employees/${employee.id}`, data({}))).status(),
  ).toBe(403);
  for (const path of [
    `/api/history?week=${week}`,
    `/api/export?week=${week}`,
    "/api/settings",
    "/api/templates",
  ])
    expect((await worker.get(path)).status()).toBe(403);
  const malicious = await (
    await worker.get(`/api/weeks?week=${week}&version=draft`)
  ).json();
  expect(malicious.shifts[0].title).toBe((await read(worker)).shifts[0].title);
  expect(malicious.issues).toEqual([]);
});
test("overlap is visible in the draft and blocks publication without changing employee data", async () => {
  const baseline = await read(worker);
  const s = shift();
  const w = await save([s, { ...s, id: "overlap", title: "התנגשות מכוונת" }]);
  expect(w.issues.some((i) => i.code === "OVERLAP")).toBe(true);
  const r = await admin.post(
    "/api/weeks/publish",
    data({ weekStart: week, revision: w.revision, reviewToken: (await (await admin.get(`/api/weeks/publish?week=${week}`)).json()).reviewToken }),
  );
  expect(r.status()).toBe(422);
  expect((await read(worker)).shifts).toEqual(baseline.shifts);
  const undo = await admin.post(
    "/api/weeks/undo",
    data({ weekStart: week, revision: w.revision }),
  );
  expect(undo.status()).toBe(200);
  expect((await undo.json()).shifts).toHaveLength(1);
});
test("whole-week reset preserves publication, rejects stale writes and can be undone", async () => {
  const date = "2032-02-01";
  const start = localToISO(date, "08:00");
  const end = localToISO(date, "12:00");
  const original: Shift = {
    ...shift("reset-assigned"),
    start,
    end,
    assignments: [{ employeeId: employee.id, start, end }],
  };
  await save([original], date);
  await publish(date);
  const published = await read(worker, date);
  const draft = await save([
    original,
    { ...original, id: "reset-other-group", group: original.group === "PATROL" ? "MANAGERS" : "PATROL", assignments: [] },
  ], date);
  const payload = { weekStart: date, revision: draft.revision };
  const response = await admin.post("/api/weeks/reset", data(payload));
  expect(response.status(), await response.text()).toBe(200);
  const reset: WeekData = await response.json();
  expect(reset.shifts).toEqual([]);
  expect(reset.hasDraft).toBe(true);
  expect(reset.revision).toBe(draft.revision + 1);
  expect((await read(worker, date)).shifts).toEqual(published.shifts);
  expect((await admin.post("/api/weeks/reset", data(payload))).status()).toBe(409);
  const history = await (await admin.get(`/api/history?week=${date}`)).json();
  expect(history.history[0].action).toBe("RESET");
  const undo = await admin.post("/api/weeks/undo", data({ weekStart: date, revision: reset.revision }));
  expect(undo.status(), await undo.text()).toBe(200);
  expect((await undo.json()).shifts).toEqual(draft.shifts);
});

test("optimistic concurrency permits one writer and rejects a stale overwrite", async () => {
  const w = await read(admin);
  const payload = { weekStart: week, revision: w.revision, shifts: w.shifts };
  const results = await Promise.all([
    admin.put("/api/weeks", data(payload)),
    admin.put("/api/weeks", data(payload)),
  ]);
  expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
});
test("shortage publication requires recorded consent and a stale publication review is rejected", async () => {
  const date = "2032-03-07";
  const previousPublication = await read(worker, date);
  const s: Shift = { ...shift("publication-shortage"), start: localToISO(date, "08:00"), end: localToISO(date, "12:00"), assignments: [] };
  const saved = await save([s], date);
  const review = await (await admin.get(`/api/weeks/publish?week=${date}`)).json();
  const input = { weekStart: date, revision: saved.revision, reviewToken: review.reviewToken };
  expect((await admin.post("/api/weeks/publish", data(input))).status()).toBe(422);
  expect((await read(worker, date)).shifts).toEqual(previousPublication.shifts);
  const published = await admin.post("/api/weeks/publish", data({ ...input, allowUnderstaffed: true }));
  expect(published.status(), await published.text()).toBe(200);
  const history = await (await admin.get(`/api/history?week=${date}`)).json();
  expect(history.history[0].action).toBe("PUBLISH_WITH_SHORTAGE_OVERRIDE");
  const edited = await save([{ ...s, title: "טיוטה נוספת" }], date);
  expect((await admin.post("/api/weeks/publish", data({ ...input, revision: edited.revision, allowUnderstaffed: true }))).status()).toBe(409);
  expect((await read(worker, date)).shifts[0].title).toBe(s.title);
});
test("copy and templates preserve overnight civil times; auto scheduling only changes the draft", async () => {
  await save([shift()]);
  const target = "2030-06-16";
  let w = await read(admin, target);
  let response = await admin.post(
    "/api/weeks/copy",
    data({ weekStart: target, revision: w.revision, sourceWeek: week }),
  );
  expect(response.status()).toBe(200);
  w = await response.json();
  expect(w.shifts[0].start).toBe(localToISO(target, "22:00"));
  expect(w.shifts[0].end).toBe(localToISO("2030-06-17", "06:00"));
  expect(w.shifts[0].id).not.toBe("integration-night");
  expect((await read(worker, target)).shifts).toEqual([]);
  response = await admin.post(
    "/api/templates",
    data({ name: "תבנית בדיקה", weekStart: week }),
  );
  expect([200, 201]).toContain(response.status());
  const { template } = await response.json();
  response = await admin.post(
    "/api/templates/apply",
    data({ templateId: template.id, weekStart: target, revision: w.revision }),
  );
  expect(response.status()).toBe(200);
  w = await response.json();
  await save(
    w.shifts.map((s) => ({ ...s, assignments: [] })),
    target,
  );
  w = await read(admin, target);
  response = await admin.post(
    "/api/weeks/auto",
    data({ weekStart: target, revision: w.revision, scope: { days: [0,1,2,3,4,5,6], groups: ["MANAGERS","PATROL"] } }),
  );
  expect(response.status()).toBe(200);
  const proposed: SchedulingProposal = await response.json();
  expect(proposed.shifts[0].assignments).toHaveLength(1);
  expect((await read(admin, target)).shifts).toEqual(w.shifts);
  const applied = await admin.post("/api/weeks/auto/apply", data({ proposalId: proposed.id }));
  expect(applied.status()).toBe(200);
  expect((await applied.json()).shifts).toEqual(proposed.shifts);
  expect(proposed.issues.filter((i) => i.severity === "error")).toEqual([]);
  expect((await read(worker, target)).shifts).toEqual([]);
});
test("Excel is a database-backed RTL workbook with two groups and seven days", async () => {
  const response = await admin.get(`/api/export?week=${week}&version=draft`);
  expect(response.status(), await response.text().catch(() => "")).toBe(200);
  expect(response.headers()["content-type"]).toContain("spreadsheetml");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await response.body()) as unknown as ExcelJS.Buffer);
  const sheet = book.worksheets[0];
  expect(sheet.views[0].rightToLeft).toBe(true);
  expect(sheet.getRow(2).cellCount).toBe(8);
  expect(sheet.getRow(2).getCell(2).text).toContain("ראשון");
  expect(sheet.getRow(2).getCell(8).text).toContain("שבת");
  const text = JSON.stringify(sheet.getSheetValues());
  expect(text).toContain("אחמ״שים");
  expect(text).toContain("סיורים");
  expect(text).toContain("סיור לילה לבדיקה");
  expect(text).toContain(employee.name);
});
test("print view contains the whole database week and forces employee access to the published snapshot", async () => {
  const draft = await admin.get(`/print?week=${week}&version=draft`);
  expect(draft.status()).toBe(200);
  const html = await draft.text();
  expect(html).toContain("סיור לילה לבדיקה");
  expect(html).toContain("אחמ״שים");
  expect(html).toContain("סיורים");
  expect(html).toContain("שבת");
  expect(html).toContain("2030-06-08");
  expect(html).not.toContain("הערה ניהולית פרטית");
  const employeePrint = await worker.get(`/print?week=${week}&version=draft`);
  expect(employeePrint.status()).toBe(200);
  const published = await employeePrint.text();
  expect(published).toContain("סיור לילה מעודכן");
  expect(published).not.toContain("סיור לילה לבדיקה");
});
test("invalid input, foreign origin and unauthenticated requests are rejected", async () => {
  const guest = await requestFactory.newContext({ baseURL });
  expect((await guest.get(`/api/weeks?week=${week}`)).status()).toBe(401);
  await guest.dispose();
  expect((await admin.get("/api/weeks?week=2030-02-31")).status()).toBe(400);
  expect(
    (
      await admin.put("/api/weeks", {
        data: { weekStart: week, revision: 0, shifts: [] },
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await admin.put(
        "/api/weeks",
        data({ weekStart: week, revision: 0, shifts: [], role: "ADMIN" }),
      )
    ).status(),
  ).toBe(400);
});
