import { test, expect, request as requestFactory, type APIRequestContext } from "@playwright/test";
import { localToISO, localDate, localTime, addDays } from "../../src/lib/time";
import type { Shift, Template, WeekData } from "../../src/lib/types";

const week = "2032-05-02";
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
let admin: APIRequestContext;
let worker: APIRequestContext;
const created: string[] = [];
const payload = (data: unknown) => ({ data, headers: { Origin: baseURL } });
async function read() {
  const response = await admin.get(`/api/weeks?week=${week}`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<WeekData>;
}
async function save(shifts: Shift[]) {
  const current = await read();
  const response = await admin.put("/api/weeks", payload({ weekStart: week, revision: current.revision, shifts }));
  expect(response.status(), await response.text()).toBe(200);
}
function shift(day: number, title: string): Shift {
  return { id: `template-test-${day}`, title, group: "PATROL", start: localToISO(addDays(week, day), "22:00"), end: localToISO(addDays(week, day + 1), "06:00"), required: 1, assignments: [], note: "לא לשמור בתבנית" };
}
async function create(extra: Record<string, unknown> = {}) {
  const response = await admin.post("/api/templates", payload({ name: `תבנית בדיקה ${Date.now()}`, weekStart: week, ...extra }));
  expect(response.status(), await response.text()).toBe(201);
  const { template } = await response.json() as { template: Template };
  created.push(template.id);
  return template;
}
async function apply(templateId: string, extra: Record<string, unknown>) {
  const current = await read();
  return admin.post("/api/templates/apply", payload({ weekStart: week, revision: current.revision, templateId, ...extra }));
}

test.beforeAll(async () => {
  admin = await requestFactory.newContext({ baseURL });
  worker = await requestFactory.newContext({ baseURL });
  for (const [client, email, password] of [
    [admin, process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.local", process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026"],
    [worker, "employee@demo.local", process.env.DEMO_EMPLOYEE_PASSWORD ?? "DemoWorker!2026"],
  ] as const) {
    const response = await client.post("/api/auth/login", payload({ email, password }));
    expect(response.status()).toBe(200);
  }
});
test.afterAll(async () => {
  for (const templateId of created) await admin.delete("/api/templates", payload({ templateId }));
  await admin?.dispose();
  await worker?.dispose();
});

test("daily templates replace one chosen day or repeat overnight shifts across the week", async () => {
  await save([shift(0, "מקור"), shift(2, "להחלפה"), shift(4, "להשאיר")]);
  const template = await create({ sourceDay: 0 });
  expect(template.shifts).toHaveLength(1);
  expect(template.shifts[0].assignments).toEqual([]);
  expect(template.shifts[0].note).toBeUndefined();
  expect((await apply(template.id, { targetDay: 2 })).status()).toBe(200);
  let current = await read();
  expect(current.shifts).toHaveLength(3);
  expect(current.shifts.find((s) => localDate(s.start) === addDays(week, 2))?.title).toBe("מקור");
  expect(current.shifts.find((s) => s.title === "להשאיר")).toBeTruthy();
  const beforeAllDays = current.shifts;
  expect((await apply(template.id, { allDays: true })).status()).toBe(200);
  current = await read();
  expect(current.shifts).toHaveLength(7);
  expect(new Set(current.shifts.map((s) => s.id)).size).toBe(7);
  for (let day = 0; day < 7; day++) {
    const copied = current.shifts.find((s) => localDate(s.start) === addDays(week, day))!;
    expect(copied.title).toBe("מקור");
    expect(localTime(copied.start)).toBe("22:00");
    expect(localDate(copied.end)).toBe(addDays(week, day + 1));
    expect(localTime(copied.end)).toBe("06:00");
  }
  const undone = await admin.post("/api/weeks/undo", payload({ weekStart: week, revision: current.revision }));
  expect(undone.status()).toBe(200);
  expect((await read()).shifts).toEqual(beforeAllDays);
  const weekly = await create({ sourceDay: 0, repeatAllDays: true });
  expect(weekly.shifts).toHaveLength(7);
  await save([shift(3, "ישן")]);
  expect((await apply(weekly.id, {})).status()).toBe(200);
  expect((await read()).shifts).toHaveLength(7);
  const beforeDelete = await read();
  expect((await worker.delete("/api/templates", payload({ templateId: template.id }))).status()).toBe(403);
  expect((await admin.delete("/api/templates", payload({ templateId: template.id }))).status()).toBe(200);
  expect((await read()).shifts).toEqual(beforeDelete.shifts);
  expect((await apply(template.id, { targetDay: 1 })).status()).toBe(404);
});

test("manager can save a daily template and delete it through confirmation", async ({ page }) => {
  await save([shift(0, "מקור לממשק")]);
  await page.context().addCookies((await admin.storageState()).cookies);
  await page.goto("/");
  await expect(page.getByLabel("בחירת שבוע", { exact: true })).toBeVisible();
  const loaded = page.waitForResponse((response) => response.url().includes(`/api/weeks?week=${week}`) && response.request().method() === "GET");
  await page.getByLabel("בחירת שבוע", { exact: true }).fill(week);
  await loaded;
  await page.locator(".schedule-actions > summary").click();
  await page.getByRole("button", { name: "תבניות שבוע", exact: true }).click();
  await page.getByRole("button", { name: "שמירת הלוח כתבנית", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("סוג התבנית").selectOption("day");
  await modal.getByLabel("יום המקור").selectOption("0");
  const name = `תבנית ממשק ${Date.now()}`;
  await modal.locator("input").fill(name);
  await modal.getByRole("button", { name: "שמירת תבנית", exact: true }).click();
  const row = modal.locator(".template-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  const templates = await (await admin.get("/api/templates")).json() as { templates: Template[] };
  created.push(templates.templates.find((t) => t.name === name)!.id);
  await expect(row.getByLabel("יום היעד")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/private/tmp/shifts-templates-mobile.png", fullPage: true });
  await row.getByRole("button", { name: /מחיקה|מחיקת/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /מחיקת תבנית|מחיקה/, exact: false }).click();
  await expect(page.getByRole("dialog").getByText("שם התבנית", { exact: true })).toBeVisible();
  await expect(page.locator(".template-row").filter({ hasText: name })).toHaveCount(0);
});
