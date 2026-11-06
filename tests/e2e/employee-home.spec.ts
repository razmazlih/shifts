import { randomUUID } from "node:crypto";
import { expect, test, request as requestFactory, type APIRequestContext, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { addDays, localToISO, weekStart } from "../../src/lib/time";
import type { PersonalSchedule } from "../../src/lib/personal-schedule";
import type { Employee, Shift, WeekData } from "../../src/lib/types";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const week = weekStart("2038-02-10");
const title = "סיור לילה במתחם הבדיקה עם שם משמרת ארוך לצורך אימות קריאות מלאה בטלפון";
const draftTitle = "טיוטה פרטית שאינה מיועדת לעובד";
const data = (value: unknown) => ({ data: value, headers: { Origin: baseURL } });
let admin: APIRequestContext, worker: APIRequestContext;
let employee: Employee;

async function enter(page: Page) {
  await page.context().addCookies((await worker.storageState()).cookies);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "המשמרת הבאה שלי", exact: true })).toBeVisible();
}
test.beforeAll(async () => {
  admin = await requestFactory.newContext({ baseURL });
  worker = await requestFactory.newContext({ baseURL });
  let response = await admin.post("/api/auth/login", data({ email: "admin@demo.local", password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026" }));
  expect(response.status(), await response.text()).toBe(200);
  const unique = randomUUID().replaceAll("-", "");
  const email = `personal-${unique}@integration.invalid`, password = `Personal!${unique}`;
  response = await admin.post("/api/employees", data({ employee: {
    name: "עובד בדיקה בעל שם ארוך לבדיקת תצוגה אישית בנייד", email, active: true,
    groups: ["PATROL"], maxWeeklyHours: 42, availability: [], timeOff: [], preferredDays: [],
  }, password }));
  expect(response.status(), await response.text()).toBe(201);
  employee = (await response.json()).employee;
  response = await worker.post("/api/auth/login", data({ email, password }));
  expect(response.status(), await response.text()).toBe(200);
  let current: WeekData = await (await admin.get(`/api/weeks?week=${week}`)).json();
  const start = localToISO(week, "22:00"), end = localToISO(addDays(week, 1), "06:00");
  const shift: Shift = { id: `personal-night-${unique}`, title, group: "PATROL", start, end, required: 1,
    assignments: [{ employeeId: employee.id, start, end }], note: "מידע ניהולי פרטי שאין להציג" };
  response = await admin.put("/api/weeks", data({ weekStart: week, revision: current.revision, shifts: [shift] }));
  expect(response.status(), await response.text()).toBe(200);
  current = await response.json();
  const review = await (await admin.get(`/api/weeks/publish?week=${week}`)).json();
  response = await admin.post("/api/weeks/publish", data({ weekStart: week, revision: current.revision, reviewToken: review.reviewToken, allowUnderstaffed: false }));
  expect(response.status(), await response.text()).toBe(200);
  current = await response.json();
  response = await admin.put("/api/weeks", data({ weekStart: week, revision: current.revision, shifts: [{ ...shift, title: draftTitle }] }));
  expect(response.status(), await response.text()).toBe(200);
});
test.afterAll(async () => { await admin?.dispose(); await worker?.dispose(); });

test("personal landing finds a published overnight beyond the selected week and keeps drafts private", async ({ page }) => {
  const response = await worker.get("/api/me/schedule?employeeId=someone-else&version=draft");
  expect(response.status()).toBe(200);
  const personal: PersonalSchedule = await response.json();
  expect(personal.nextShift).toMatchObject({ title, weekStart: week });
  expect(JSON.stringify(personal)).not.toContain(draftTitle);
  expect(JSON.stringify(personal)).not.toContain("מידע ניהולי");
  expect(JSON.stringify(personal)).not.toContain("employeeId");
  await enter(page);
  await expect(page.getByTestId("personal-main-shift")).toContainText(title);
  await expect(page.getByTestId("personal-main-shift")).toContainText("22:00–06:00");
  await expect(page.getByText(/הסיום ביום הבא/)).toBeVisible();
  await expect(page.locator(".employee-home").getByRole("button", { name: "לוח הצוות", exact: true })).toBeVisible();
  await expect(page.getByText(draftTitle, { exact: true })).toHaveCount(0);
});

test("published default export and print match the exact version employees see", async () => {
  const visible: WeekData = await (await worker.get(`/api/weeks?week=${week}`)).json();
  const exported = await admin.get(`/api/export?week=${week}`);
  expect(exported.status()).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await exported.body()) as unknown as ExcelJS.Buffer);
  const detailSheet = workbook.getWorksheet("פירוט שיבוצים")!;
  expect(detailSheet.getRow(3).getCell(3).text).toBe(visible.shifts[0].title);
  expect(detailSheet.getRow(3).getCell(6).text).toBe(employee.name);
  expect(detailSheet.getRow(3).getCell(7).text).toBe(`${week} 22:00`);
  expect(detailSheet.getRow(3).getCell(8).text).toBe(`${addDays(week, 1)} 06:00`);
  expect(JSON.stringify(workbook.worksheets.map(sheet => sheet.getSheetValues()))).not.toContain(draftTitle);
  const publishedPrint = await (await admin.get(`/print?week=${week}`)).text();
  expect(publishedPrint).toContain(title);
  expect(publishedPrint).not.toContain(draftTitle);
  const draftPrint = await (await admin.get(`/print?week=${week}&version=draft`)).text();
  expect(draftPrint).toContain(draftTitle);
  expect(draftPrint).toContain("טיוטת מנהל — אינה הסידור המחייב לצוות");
});

test("failed refresh is clearly reported and retains the last loaded published information", async ({ page }) => {
  await enter(page);
  await page.route("**/api/me/schedule", route => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "רענון המשמרות האישיות" }).click();
  await expect(page.locator(".employee-home").getByRole("alert")).toContainText("שגיאת טעינה");
  await expect(page.locator(".employee-home").getByRole("alert")).toContainText("מוצג המידע מהטעינה הקודמת");
  await expect(page.getByTestId("personal-main-shift")).toContainText(title);
  await page.unroute("**/api/me/schedule");
  await page.getByRole("button", { name: "רענון המשמרות האישיות" }).click();
  await expect(page.getByText("שגיאת טעינה", { exact: true })).toHaveCount(0);
  await page.route("**/api/me/schedule", route => route.abort("internetdisconnected"));
  await page.reload();
  await expect(page.locator(".employee-home").getByRole("alert")).toContainText("שגיאת טעינה");
  await expect(page.getByTestId("personal-main-shift")).toHaveCount(0);
  await expect(page.getByText("אין משמרות עתידיות במידע הזמין", { exact: true })).toHaveCount(0);
});

test("personal cards remain readable at 360, 390, 768 and 1440 pixels", async ({ page }) => {
  await enter(page);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width <= 720) {
      // Wait for the existing sidebar's responsive slide-out transition before
      // inspecting or capturing the mobile layout; it must not cover the card.
      await expect.poll(() => page.locator(".sidebar").evaluate(element => element.getBoundingClientRect().left >= window.innerWidth)).toBe(true);
    }
    await expect(page.getByTestId("personal-main-shift")).toContainText(title);
    await expect(page.getByText(/הסיום ביום הבא/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `docs/screenshots/employee-home-${width}.png`, fullPage: true, animations: "disabled" });
  }
});
