import { test, expect, request as requestFactory, type APIRequestContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { SchedulingProposal, Template, WeekData } from "../../src/lib/types";

const WEEK = "2033-02-06";

async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
}

test("manager creates a reusable template, previews and applies the exact week proposal, edits on phone and undoes the complete operation", async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  let templateId: string | undefined;
  let worker: APIRequestContext | undefined;
  async function request<T>(path: string, method = "GET", data?: unknown): Promise<T> {
    const response = await context.request.fetch(path, { method, data, headers: { Origin: origin } });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  }
  const read = () => request<WeekData>(`/api/weeks?week=${WEEK}`);
  try {
    await request("/api/auth/login", "POST", {
      email: process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.local",
      password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026",
    });
    const initial = await read();
    const baseline = await request<WeekData>("/api/weeks", "PUT", { weekStart: WEEK, revision: initial.revision, shifts: [] });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /לוח משמרות/, level: 1 })).toBeVisible();
    const loaded = page.waitForResponse((response) => response.url().includes(`/api/weeks?week=${WEEK}`) && response.request().method() === "GET");
    await page.getByLabel("בחירת שבוע", { exact: true }).fill(WEEK);
    await loaded;
    await expect(page.locator(".calendar-loading")).toBeHidden();
    await page.getByRole("button", { name: "שיבוץ חכם", exact: true }).click();
    await expect(page.getByLabel("תבנית לשבוע", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "יצירת תבנית", exact: true }).click();
    const builder = page.getByRole("dialog");
    const name = "שבוע רגיל";
    await builder.getByLabel("שם לתבנית", { exact: true }).fill(name);
    await page.setViewportSize({ width: 360, height: 800 });
    await fitsViewport(page);
    await mkdir("output/playwright", { recursive: true });
    await page.screenshot({ path: "output/playwright/template-builder-mobile.png" });
    const createdResponse = page.waitForResponse((response) => response.url().endsWith("/api/templates") && response.request().method() === "POST");
    await builder.getByRole("button", { name: "שמירת תבנית חדשה", exact: true }).click();
    const created = await createdResponse;
    expect(created.status(), await created.text()).toBe(201);
    const { template } = await created.json() as { template: Template };
    templateId = template.id;
    expect(template.shifts.length).toBeGreaterThan(1);
    expect(template.shifts.every((shift) => shift.assignments.length === 0)).toBe(true);
    await expect(page.getByRole("dialog", { name: "שיבוץ חכם", exact: true })).toBeVisible();
    await page.getByLabel("תבנית לשבוע", { exact: true }).selectOption(template.id);
    const proposalResponse = page.waitForResponse((response) => response.url().endsWith("/api/weeks/auto") && response.request().method() === "POST");
    await page.getByRole("button", { name: "יצירת הצעה לבדיקה", exact: true }).click();
    const proposal = await (await proposalResponse).json() as SchedulingProposal;
    expect((await read()).revision).toBe(baseline.revision);
    expect((await read()).shifts).toEqual([]);
    await expect(page.getByRole("dialog", { name: "תצוגה מקדימה לשיבוץ", exact: true })).toBeVisible();
    await page.getByRole("dialog", { name: "תצוגה מקדימה לשיבוץ", exact: true }).screenshot({ path: "output/playwright/scheduling-preview.png", animations: "disabled" });
    const appliedResponse = page.waitForResponse((response) => response.url().endsWith("/api/weeks/auto/apply") && response.request().method() === "POST");
    await page.getByRole("button", { name: "החלה על הטיוטה", exact: true }).click();
    const applied = await appliedResponse;
    expect(applied.status(), await applied.text()).toBe(200);
    const result = await applied.json() as WeekData;
    expect(result.revision).toBe(baseline.revision + 1);
    expect(result.shifts).toEqual(proposal.shifts);
    expect(result.shifts).toHaveLength(template.shifts.length);
    expect(result.shifts.every((shift) => shift.assignments.length > 0)).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.autoSummary?.unfilledShifts).toBe(0);
    expect(result.publishedRevision).toBe(baseline.publishedRevision);
    await expect(page.locator(".auto-result")).toContainText("הסידור תקין וכל המשמרות מכוסות");
    await fitsViewport(page);
    await expect(page.locator(".toast")).toBeHidden();
    await page.screenshot({ path: "output/playwright/template-smart-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await fitsViewport(page);
    await page.screenshot({ path: "output/playwright/template-smart-desktop.png", fullPage: true });
    await mkdir("docs/images", { recursive: true });
    await page.getByRole("button", { name: "שיבוץ חכם", exact: true }).click();
    await page.getByRole("dialog", { name: "שיבוץ חכם", exact: true }).screenshot({ path: "docs/images/manager-quick-week.png" });
    await page.getByRole("button", { name: "ביטול", exact: true }).click();

    worker = await requestFactory.newContext({ baseURL: origin });
    const login = await worker.post("/api/auth/login", { data: { email: "employee@demo.local", password: process.env.DEMO_EMPLOYEE_PASSWORD ?? "DemoWorker!2026" }, headers: { Origin: origin } });
    expect(login.ok()).toBe(true);
    const forbidden = await worker.post("/api/templates/apply", { data: { weekStart: WEEK, revision: result.revision, templateId, autoSchedule: true }, headers: { Origin: origin } });
    expect(forbidden.status()).toBe(403);
    const stale = await context.request.post("/api/templates/apply", { data: { weekStart: WEEK, revision: baseline.revision, templateId, autoSchedule: true }, headers: { Origin: origin } });
    expect(stale.status()).toBe(409);
    expect((await read()).shifts).toEqual(result.shifts);

    await page.setViewportSize({ width: 360, height: 800 });
    await page.locator(".shift-card").first().click();
    const editor = page.getByRole("dialog", { name: "פרטי המשמרת", exact: true });
    await editor.locator(".shift-hours > summary").click();
    await editor.getByLabel("שם המשמרת", { exact: true }).fill("עדכון ידני אחרי שיבוץ");
    await fitsViewport(page);
    await editor.getByRole("button", { name: "שמירת משמרת", exact: true }).click();
    await expect(editor).toBeHidden();
    const edited = await read();
    expect(edited.shifts.some((shift) => shift.title === "עדכון ידני אחרי שיבוץ")).toBe(true);
    for (const shift of result.shifts) expect(edited.shifts.find((item) => item.id === shift.id)?.assignments).toEqual(shift.assignments);
    async function undo() {
      const tools = page.locator("details.schedule-actions");
      if (await tools.count() && !(await tools.evaluate((element) => (element as HTMLDetailsElement).open))) await tools.locator(":scope > summary").click();
      await page.getByRole("button", { name: "ביטול השינוי האחרון", exact: true }).click();
      const confirm = page.getByRole("dialog");
      await confirm.getByRole("button", { name: "ביטול שינוי", exact: true }).click();
      await expect(confirm).toBeHidden();
    }
    await undo();
    expect((await read()).shifts).toEqual(result.shifts);
    await undo();
    const restored = await read();
    expect(restored.shifts).toEqual([]);
    expect(restored.publishedRevision).toBe(baseline.publishedRevision);
  } finally {
    if (templateId) await request("/api/templates", "DELETE", { templateId, revision: 0 });
    await worker?.dispose();
  }
});
