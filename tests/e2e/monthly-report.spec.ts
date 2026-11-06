import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { test, expect, request as requestFactory, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { localToISO } from "../../src/lib/time";
import type { MonthlyReport } from "../../src/lib/monthly-report";
import type { Employee, SessionUser, Shift, WeekData } from "../../src/lib/types";

const WEEK = "2037-05-03";
const MONTH = "2037-05";
const OWN_TITLE = "דוח חודשי · משמרת אישית";
const SECOND_TITLE = "דוח חודשי · משמרת נוספת";
const OTHER_TITLE = "דוח חודשי · משמרת עמית";
const DRAFT_TITLE = "טיוטה שלא פורסמה בדוח";
const NOTE = "הערת מנהל פרטית בדוח";
let adminContext: BrowserContext;
let workerContext: BrowserContext;
let admin: Page;
let worker: Page;
let own: Employee;
let other: Employee;
let origin: string;
let fixtureSaved = false;
let cleanupAuth: Awaited<ReturnType<BrowserContext["storageState"]>>;

async function request<T>(client: APIRequestContext, path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await client.fetch(path, { method, data, headers: { Origin: origin } });
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function save(shifts: Shift[], client = adminContext.request) {
  const current = await request<WeekData>(client, `/api/weeks?week=${WEEK}`);
  return request<WeekData>(client, "/api/weeks", "PUT", { weekStart: WEEK, revision: current.revision, shifts });
}
async function publish(shifts: Shift[], client = adminContext.request) {
  const saved = await save(shifts, client);
  return request<WeekData>(client, "/api/weeks/publish", "POST", { weekStart: WEEK, revision: saved.revision });
}
async function openReport(page: Page, manager: boolean) {
  page.on("pageerror", (error) => console.error(`Monthly report page error: ${error.message}`));
  page.on("requestfailed", (entry) => { if (entry.url().includes("/_next/")) console.error(`Monthly report chunk failed: ${entry.url()} ${entry.failure()?.errorText}`); });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(manager ? "לוח משמרות" : "המשמרות שלי");
  await page.getByRole("button", { name: manager ? "סיכום חודשי" : "החודש שלי", exact: true }).click();
  await page.getByLabel("בחירת חודש", { exact: true }).fill(MONTH);
  await expect(page.locator(".report-stats")).toBeVisible();
}
function shift(title: string, employee: Employee, date: string, startTime: string, endTime: string): Shift {
  const start = localToISO(date, startTime), end = localToISO(date, endTime);
  return { id: randomUUID(), title, group: employee.groups[0], start, end, required: 1, assignments: [{ employeeId: employee.id, start, end }], note: NOTE };
}

test.describe("monthly published reports", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ browser, baseURL }) => {
    origin = new URL(baseURL ?? "http://localhost:3000").origin;
    adminContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
    workerContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 } });
    await request(adminContext.request, "/api/auth/login", "POST", { email: process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.local", password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026" });
    cleanupAuth = await adminContext.storageState();
    await request(workerContext.request, "/api/auth/login", "POST", { email: process.env.DEMO_EMPLOYEE_EMAIL ?? "employee@demo.local", password: process.env.DEMO_EMPLOYEE_PASSWORD ?? "DemoWorker!2026" });
    const { user } = await request<{ user: SessionUser }>(workerContext.request, "/api/auth/me");
    const original = await request<WeekData>(adminContext.request, `/api/weeks?week=${WEEK}`);
    const originalPublication = await request<WeekData>(workerContext.request, `/api/weeks?week=${WEEK}`);
    // Only recover this test's abandoned fixtures; never replace foreign schedules.
    const fixtureTitles = new Set([OWN_TITLE, SECOND_TITLE, OTHER_TITLE, DRAFT_TITLE]);
    expect(original.shifts.every((entry) => fixtureTitles.has(entry.title) && entry.note === NOTE), "Reserved fixture week contains foreign draft data").toBeTruthy();
    const knownIds = new Set(original.shifts.map((entry) => entry.id));
    expect(originalPublication.shifts.every((entry) => fixtureTitles.has(entry.title) && knownIds.has(entry.id)), "Reserved fixture week contains foreign published data").toBeTruthy();
    own = original.employees.find((employee) => employee.id === user.employeeId)!;
    other = original.employees.find((employee) => employee.id !== own.id && employee.active && employee.groups.length > 0)!;
    expect(own).toBeTruthy();
    expect(other).toBeTruthy();
    fixtureSaved = true;
    const shifts = [shift(OWN_TITLE, own, "2037-05-05", "08:00", "12:00"), shift(SECOND_TITLE, own, "2037-05-08", "08:00", "10:00"), shift(OTHER_TITLE, other, "2037-05-07", "08:00", "14:00")];
    await publish(shifts);
    await save(shifts.map((entry) => ({ ...entry, title: DRAFT_TITLE })));
    admin = await adminContext.newPage();
    worker = await workerContext.newPage();
  });
  test.afterAll(async () => {
    try {
      if (fixtureSaved) {
        // A standalone API session survives browser teardown after a UI timeout.
        const cleanup = await requestFactory.newContext({ baseURL: origin, storageState: cleanupAuth });
        try {
          await publish([], cleanup);
        } finally { await cleanup.dispose(); }
      }
    } finally { await Promise.all([adminContext?.close(), workerContext?.close()]); }
  });

  test("API enforces personal visibility and reports published assignments despite newer drafts", async ({ request: anonymous }) => {
    expect((await anonymous.get(`/api/reports/monthly?month=${MONTH}`)).status()).toBe(401);
    expect((await workerContext.request.get("/api/reports/monthly?month=2037-13")).status()).toBe(400);
    const report = await request<MonthlyReport>(workerContext.request, `/api/reports/monthly?month=${MONTH}&employeeId=${other.id}`);
    expect(report.source).toBe("published");
    expect(report.employees).toHaveLength(1);
    expect(report.employees[0].id).toBe(own.id);
    expect(report.employees[0].totals).toMatchObject({ hours: 6, shifts: 2, days: 2 });
    expect(report.employees[0].shifts.map((entry) => entry.title)).toEqual([OWN_TITLE, SECOND_TITLE]);
    expect(JSON.stringify(report)).not.toContain(OTHER_TITLE);
    expect(JSON.stringify(report)).not.toContain(DRAFT_TITLE);
    expect(JSON.stringify(report)).not.toContain(NOTE);
    const team = await request<MonthlyReport>(adminContext.request, `/api/reports/monthly?month=${MONTH}`);
    expect(team.employees.find((entry) => entry.id === other.id)?.totals).toMatchObject({ hours: 6, shifts: 1, days: 1 });
    expect(JSON.stringify(team)).not.toContain(DRAFT_TITLE);
  });

  test("employee navigates months and filters calendar days on mobile without overflow", async () => {
    await openReport(worker, false);
    await expect(worker.locator(".report-stat").nth(0)).toContainText("6");
    await expect(worker.locator(".report-stat").nth(1)).toContainText("2");
    await expect(worker.getByText(OWN_TITLE, { exact: true })).toBeVisible();
    await expect(worker.getByText(OTHER_TITLE, { exact: true })).toHaveCount(0);
    await expect(worker.getByLabel("בחירת עובד לסיכום")).toHaveCount(0);
    await worker.getByRole("button", { name: "החודש הבא", exact: true }).click();
    await expect(worker.getByLabel("בחירת חודש", { exact: true })).toHaveValue("2037-06");
    await expect(worker.locator(".report-stat").nth(0).locator("strong")).toHaveText("0");
    await worker.getByRole("button", { name: "החודש הקודם", exact: true }).click();
    await expect(worker.getByText(SECOND_TITLE, { exact: true })).toBeVisible();
    await worker.setViewportSize({ width: 390, height: 844 });
    // Wait for the existing sidebar exit animation before judging mobile layout.
    await expect.poll(() => worker.locator(".sidebar").evaluate((element) => element.getBoundingClientRect().left)).toBeGreaterThanOrEqual(390);
    await worker.locator(".report-day.has-shifts").first().click();
    await expect(worker.getByText(OWN_TITLE, { exact: true })).toBeVisible();
    await expect(worker.getByText(SECOND_TITLE, { exact: true })).toHaveCount(0);
    await worker.getByRole("button", { name: "כל הימים", exact: true }).click();
    await expect(worker.getByText(SECOND_TITLE, { exact: true })).toBeVisible();
    expect(await worker.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    for (const selector of [".monthly-report .page-heading", ".monthly-report .report-source", ".monthly-report .report-stats"]) {
      const element = worker.locator(selector);
      const box = await element.boundingBox();
      expect(box, `${selector} should have a visible layout box`).not.toBeNull();
      if (box!.x < 12 || box!.x + box!.width > 378) {
        console.error("Monthly report geometry:", JSON.stringify(await element.evaluate((target) => {
          const chain = [];
          for (let node: Element | null = target; node; node = node.parentElement) {
            const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
            chain.push({ element: node.tagName, classes: node.className, left: rect.left, right: rect.right, width: rect.width, cssWidth: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth, margin: style.margin, padding: style.padding, overflowX: style.overflowX, direction: style.direction, display: style.display, transform: style.transform });
          }
          return chain;
        })));
      }
      expect(box!.x, `${selector} left margin`).toBeGreaterThanOrEqual(12);
      expect(box!.x + box!.width, `${selector} right margin`).toBeLessThanOrEqual(378);
    }
    await mkdir("output/playwright", { recursive: true });
    await worker.screenshot({ path: "output/playwright/monthly-worker-mobile.png", fullPage: true });
  });

  test("manager compares employees and opens personal details", async () => {
    await openReport(admin, true);
    await expect(admin.getByRole("heading", { name: "השוואת עובדים", exact: true })).toBeVisible();
    await admin.getByLabel("חיפוש עובד בדוח").fill(own.name);
    await expect(admin.locator(".report-table tbody tr")).toHaveCount(1);
    await admin.getByRole("button", { name: own.name, exact: true }).click();
    await expect(admin.getByText(OWN_TITLE, { exact: true })).toBeVisible();
    await admin.getByLabel("השוואה לעובד נוסף", { exact: true }).selectOption(other.id);
    await expect(admin.getByRole("heading", { name: "השוואה אישית", exact: true })).toBeVisible();
    await expect(admin.locator(".report-table tbody tr")).toHaveCount(2);
    await admin.getByLabel("בחירת עובד לסיכום").selectOption(other.id);
    await expect(admin.getByText(OTHER_TITLE, { exact: true })).toBeVisible();
    await expect(admin.getByText(OWN_TITLE, { exact: true })).toHaveCount(0);
    await mkdir("output/playwright", { recursive: true });
    await admin.screenshot({ path: "output/playwright/monthly-manager-desktop.png", fullPage: true });
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.getByLabel("בחירת עובד לסיכום").selectOption("ALL");
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });
});
