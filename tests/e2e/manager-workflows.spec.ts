import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { addDays, localToISO, today, weekStart, weekDates } from "../../src/lib/time";
import type { Employee, Shift, WeekData } from "../../src/lib/types";

const WEEK = "2038-06-06";
const EMPTY_WEEK = "2038-08-01";
function client(context: APIRequestContext, baseURL?: string) {
  return async function request<T>(path: string, method = "GET", data?: unknown): Promise<T> {
    const response = await context.fetch(path, { method, data, headers: { Origin: new URL(baseURL ?? "http://localhost:3000").origin } });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  };
}
async function login(request: ReturnType<typeof client>) { await request("/api/auth/login", "POST", { email: process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.local", password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026" }); }
async function pickWeek(page: Page, week: string) {
  await page.getByLabel("בחירת שבוע", { exact: true }).fill(week);
  await expect(page.locator(".calendar-loading")).toBeHidden();
}
async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("manager warnings remain readable across screen sizes with dense, overnight, long-name and empty weeks", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  const request = client(context.request, baseURL);
  await login(request);
  const people: Employee[] = [];
  for (const name of ["עובד בדיקה עם שם ארוך במיוחד לבדיקת קריאות", "סייר בדיקה שני עם שם משפחה ארוך"]) {
    const result = await request<{ employee: Employee }>("/api/employees", "POST", { employee: { name, active: true, groups: ["PATROL"], maxWeeklyHours: 80, availability: [], timeOff: [], preferredDays: [] } });
    people.push(result.employee);
  }
  const start = localToISO(WEEK, "15:00"), end = localToISO(WEEK, "23:00"), partialEnd = localToISO(WEEK, "19:00");
  const partial: Shift = { id: randomUUID(), title: "סיור ערב עם חוסר חלקי", group: "PATROL", start, end, required: 2, assignments: [{ employeeId: people[0].id, start, end }, { employeeId: people[1].id, start, end: partialEnd }] };
  const overlap: Shift = { ...partial, id: randomUUID(), title: "תגבור חופף לבדיקה", start: localToISO(WEEK, "18:00"), end: localToISO(WEEK, "20:00"), required: 1, assignments: [{ employeeId: people[0].id, start: localToISO(WEEK, "18:00"), end: localToISO(WEEK, "20:00") }] };
  const night: Shift = { id: randomUUID(), title: "סיור לילה לבדיקה", group: "PATROL", start: localToISO(WEEK, "23:00"), end: localToISO(addDays(WEEK, 1), "07:00"), required: 1, assignments: [] };
  const dense = Array.from({ length: 12 }, (_, index): Shift => ({ id: randomUUID(), title: `משמרת בדיקה עמוסה ${index + 1}`, group: index % 2 ? "PATROL" : "MANAGERS", start: localToISO(addDays(WEEK, index % 7), "08:00"), end: localToISO(addDays(WEEK, index % 7), "16:00"), required: 1, assignments: [] }));
  const original = await request<WeekData>(`/api/weeks?week=${WEEK}`);
  await request("/api/weeks", "PUT", { weekStart: WEEK, revision: original.revision, shifts: [partial, overlap, night, ...dense] });
  const empty = await request<WeekData>(`/api/weeks?week=${EMPTY_WEEK}`);
  await request("/api/weeks", "PUT", { weekStart: EMPTY_WEEK, revision: empty.revision, shifts: [] });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /לוח משמרות/ })).toBeVisible();
  await mkdir("output/playwright/stage-a", { recursive: true });
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await pickWeek(page, WEEK);
    await page.getByRole("button", { name: "רשימה", exact: true }).click();
    const cards = page.locator(".shift-card");
    await expect(cards.filter({ hasText: "חסר סייר בין 19:00 ל־23:00" }).first()).toBeVisible();
    await expect(cards.filter({ hasText: "חפיפה" }).first()).toBeVisible();
    await fitsViewport(page);
    await page.screenshot({ path: `output/playwright/stage-a/manager-dense-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "ציר זמן", exact: true }).click();
    await expect(cards.filter({ hasText: "חסר סייר בין 19:00 ל־23:00" }).first()).toBeVisible();
    await expect(cards.filter({ hasText: "חפיפה" }).first()).toBeVisible();
    const visibleGap = cards.filter({ hasText: "חסר סייר בין 19:00 ל־23:00" }).first().locator(".shift-warnings > span").filter({ hasText: "חסר סייר בין 19:00 ל־23:00" });
    await visibleGap.scrollIntoViewIfNeeded();
    await expect(visibleGap).toBeInViewport({ ratio: 1 });
    await fitsViewport(page);
    await page.screenshot({ path: `output/playwright/stage-a/manager-timeline-${width}.png`, fullPage: true });
    await pickWeek(page, EMPTY_WEEK);
    await expect(page.getByText("השבוע ריק — הכיסוי טרם הוגדר", { exact: true })).toBeVisible();
    await fitsViewport(page);
    await page.screenshot({ path: `output/playwright/stage-a/manager-empty-${width}.png`, fullPage: true });
  }
});

test("Today resets selected day and failed network save retains input with an explicit unsaved status", async ({ page, context, baseURL }) => {
  const request = client(context.request, baseURL);
  await login(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".calendar-loading")).toBeHidden();
  const todayIndex = weekDates(weekStart(today())).indexOf(today());
  const otherIndex = (todayIndex + 1) % 7;
  await page.locator(".timeline-days button").nth(otherIndex).click();
  await expect(page.locator(".timeline-days button").nth(otherIndex)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "היום", exact: true }).click();
  await expect(page.locator(".timeline-days button").nth(todayIndex)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "משמרת חדשה", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "משמרת חדשה", exact: true });
  await editor.locator(".shift-hours > summary").click();
  const title = editor.getByLabel("שם המשמרת", { exact: true });
  await title.fill("קלט שיישמר לאחר כשל רשת");
  await page.route("**/api/weeks", route => route.request().method() === "PUT" ? route.abort("failed") : route.continue());
  await editor.getByRole("button", { name: "שמירת משמרת", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("לא נשמר");
  await expect(title).toHaveValue("קלט שיישמר לאחר כשל רשת");
  await expect(page.locator(".toast")).toHaveCount(0);
  await mkdir("output/playwright/stage-a", { recursive: true });
  await editor.screenshot({ path: "output/playwright/stage-a/manager-unsaved-input.png" });
  await page.unroute("**/api/weeks");
  await editor.getByRole("button", { name: "שמירת משמרת", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator(".toast")).toContainText("נשמרו בטיוטה");
});
