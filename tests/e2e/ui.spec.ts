import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { SessionUser, Shift, WeekData } from "../../src/lib/types";
import { localToISO } from "../../src/lib/time";

const WEEK = "2030-07-07";
const ORIGINAL = "בדיקת ממשק · משמרת לילה";
const UPDATED = "בדיקת ממשק · לילה מעודכן";
const OTHER = "בדיקת ממשק · משמרת של עמית";
const PRIVATE_NOTE = "הערת מנהל פרטית לבדיקת הרשאות";
let managerContext: BrowserContext;
let employeeContext: BrowserContext;
let manager: Page;
let employee: Page;
let origin: string;

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("כתובת אימייל", { exact: true }).fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(password);
  await page.getByRole("button", { name: "כניסה למערכת", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: /לוח משמרות|המשמרות שלי/,
      exact: false,
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("בחירת שבוע", { exact: true })).toBeVisible();
}
async function request<T>(
  client: APIRequestContext,
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  data?: unknown,
): Promise<T> {
  const response = await client.fetch(path, {
    method,
    data,
    headers: { Origin: origin },
  });
  expect(
    response.ok(),
    `${method} ${path}: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return response.json();
}
async function chooseWeek(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/weeks?week=${WEEK}`) &&
      r.request().method() === "GET",
  );
  await page.getByLabel("בחירת שבוע", { exact: true }).fill(WEEK);
  await response;
  await expect(page.getByLabel("בחירת שבוע", { exact: true })).toHaveValue(
    WEEK,
  );
}
function card(page: Page, title: string) {
  return page
    .locator("button.shift-card")
    .filter({ has: page.getByText(title, { exact: true }) });
}

test.describe("manager publication and employee live schedule UI", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ browser, baseURL }) => {
    origin = new URL(baseURL ?? "http://localhost:3000").origin;
    managerContext = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1440, height: 1000 },
    });
    employeeContext = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 900 },
    });
    manager = await managerContext.newPage();
    employee = await employeeContext.newPage();
    await login(
      manager,
      process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.local",
      process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026",
    );
    await login(
      employee,
      process.env.DEMO_EMPLOYEE_EMAIL ?? "employee@demo.local",
      process.env.DEMO_EMPLOYEE_PASSWORD ?? "DemoWorker!2026",
    );
    const { user } = await request<{ user: SessionUser }>(
      employeeContext.request,
      "/api/auth/me",
    );
    expect(user.role).toBe("EMPLOYEE");
    const week = await request<WeekData>(
      managerContext.request,
      `/api/weeks?week=${WEEK}`,
    );
    const own = week.employees.find((e) => e.id === user.employeeId);
    expect(
      own,
      "Seeded employee login must have an employee record",
    ).toBeTruthy();
    const other = week.employees.find(
      (e) => e.id !== own!.id && e.active && e.groups.includes(own!.groups[0]),
    );
    expect(
      other,
      "Fixture requires a second employee in the same team",
    ).toBeTruthy();
    const start = localToISO(WEEK, "22:00");
    const end = localToISO("2030-07-08", "06:00");
    const otherStart = localToISO("2030-07-08", "14:00");
    const otherEnd = localToISO("2030-07-08", "18:00");
    const shifts: Shift[] = [
      {
        id: randomUUID(),
        title: ORIGINAL,
        group: own!.groups[0],
        required: 1,
        start,
        end,
        assignments: [{ employeeId: own!.id, start, end }],
        note: PRIVATE_NOTE,
      },
      {
        id: randomUUID(),
        title: OTHER,
        group: own!.groups[0],
        required: 1,
        start: otherStart,
        end: otherEnd,
        assignments: [
          { employeeId: other!.id, start: otherStart, end: otherEnd },
        ],
      },
    ];
    const saved = await request<WeekData>(
      managerContext.request,
      "/api/weeks",
      "PUT",
      { weekStart: WEEK, revision: week.revision, shifts },
    );
    const published = await request<WeekData>(
      managerContext.request,
      "/api/weeks/publish",
      "POST",
      { weekStart: WEEK, revision: saved.revision },
    );
    expect(published.issues.filter((i) => i.severity === "error")).toEqual([]);
    await chooseWeek(manager);
    await chooseWeek(employee);
  });

  test.afterAll(async () => {
    await managerContext?.close();
    await employeeContext?.close();
  });

  test("keeps a night-shift edit private until publication, then updates employee without reload", async () => {
    await expect(card(manager, ORIGINAL)).toBeVisible();
    await expect(card(employee, ORIGINAL)).toBeVisible();
    await expect(card(employee, ORIGINAL)).toContainText("22:00–06:00");
    await expect(card(employee, ORIGINAL)).toContainText("+1");
    await expect(card(employee, OTHER)).toHaveCount(0);
    await expect(employee.getByText(PRIVATE_NOTE, { exact: true })).toHaveCount(
      0,
    );

    await card(manager, ORIGINAL).click();
    const editor = manager.getByRole("dialog", {
      name: "פרטי המשמרת",
      exact: true,
    });
    await editor.locator(".shift-hours > summary").click();
    await editor.getByLabel("שם המשמרת", { exact: true }).fill(UPDATED);
    await editor
      .getByRole("button", { name: "שמירת משמרת", exact: true })
      .click();
    await expect(editor).toBeHidden();
    await expect(card(manager, UPDATED)).toBeVisible();
    await expect(
      manager.getByText("טיוטה · טרם פורסמה", { exact: true }),
    ).toBeVisible();

    const draftRefresh = employee.waitForResponse((r) =>
      r.url().includes(`/api/weeks?week=${WEEK}`),
    );
    await employee
      .getByRole("button", { name: "רענון הלוח", exact: true })
      .click();
    await draftRefresh;
    await expect(card(employee, ORIGINAL)).toBeVisible();
    await expect(card(employee, UPDATED)).toHaveCount(0);

    await manager
      .getByRole("button", { name: "פרסום לצוות", exact: true })
      .click();
    const confirmation = manager.getByRole("dialog", {
      name: "לפרסם את השבוע לצוות?",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    const publishResponse = manager.waitForResponse(
      (r) =>
        r.url().endsWith("/api/weeks/publish") &&
        r.request().method() === "POST",
    );
    await confirmation
      .getByRole("button", { name: "פרסום לצוות", exact: true })
      .click();
    expect((await publishResponse).ok()).toBeTruthy();
    await expect(confirmation).toBeHidden();

    // Exercise the actual focus refresh listener, preserving this document and
    // its selected week instead of navigating/reloading the employee page.
    await employee.bringToFront();
    await employee.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(card(employee, UPDATED)).toBeVisible({ timeout: 30_000 });
    await expect(card(employee, ORIGINAL)).toHaveCount(0);
    await expect(
      employee.getByLabel("בחירת שבוע", { exact: true }),
    ).toHaveValue(WEEK);
    await card(employee, UPDATED).click();
    const detail = employee.getByRole("dialog", { name: UPDATED, exact: true });
    await expect(
      detail.getByRole("heading", { name: "השיבוץ שלי", exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByRole("button", { name: "שמירת משמרת", exact: true }),
    ).toHaveCount(0);
    await expect(detail.getByText(PRIVATE_NOTE, { exact: true })).toHaveCount(
      0,
    );
    await detail.getByRole("button", { name: "סגירה", exact: true }).click();
    await mkdir("output/playwright", { recursive: true });
    await manager.screenshot({
      path: "output/playwright/manager-published-desktop.png",
      fullPage: true,
    });
  });

  test("employee mobile view fits 390px and shows only personal schedule information", async () => {
    await employee.setViewportSize({ width: 390, height: 844 });
    await expect(card(employee, UPDATED)).toBeVisible();
    await expect(card(employee, OTHER)).toHaveCount(0);
    for (const label of [
      "פרסום לצוות",
      "משמרת חדשה",
      "שיבוץ חכם",
      "אנשי הצוות",
      "הגדרות שיבוץ",
      "העתקת השבוע הקודם",
      "ביטול השינוי האחרון",
    ]) {
      await expect(
        employee.getByRole("button", { name: label, exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      employee.getByRole("button", { name: "כל הצוות", exact: true }),
    ).toHaveCount(0);
    await expect(employee.getByText("חברי הצוות", { exact: true })).toHaveCount(
      0,
    );
    await expect(employee.locator(".stat-card")).toHaveCount(2);
    await expect(
      employee.locator(".shift-warning, .shift-covered"),
    ).toHaveCount(0);
    const overflow = await employee.evaluate(() => ({
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
    await mkdir("output/playwright", { recursive: true });
    await employee.screenshot({
      path: "output/playwright/employee-mobile.png",
      fullPage: true,
    });
  });

  test("publishes an empty draft to cancel every previously published shift", async () => {
    const current = await request<WeekData>(
      managerContext.request,
      `/api/weeks?week=${WEEK}`,
    );
    await request<WeekData>(managerContext.request, "/api/weeks", "PUT", {
      weekStart: WEEK,
      revision: current.revision,
      shifts: [],
    });
    const refresh = manager.waitForResponse((r) =>
      r.url().includes(`/api/weeks?week=${WEEK}`),
    );
    await manager
      .getByRole("button", { name: "רענון הלוח", exact: true })
      .click();
    await refresh;
    await expect(manager.locator("button.shift-card")).toHaveCount(0);
    await expect(
      manager.getByRole("button", { name: "פרסום לצוות", exact: true }),
    ).toBeEnabled();
    await manager
      .getByRole("button", { name: "פרסום לצוות", exact: true })
      .click();
    await manager
      .getByRole("dialog", { name: "לפרסם את השבוע לצוות?", exact: true })
      .getByRole("button", { name: "פרסום לצוות", exact: true })
      .click();
    await expect(manager.getByRole("dialog")).toHaveCount(0);
    await employee.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(employee.locator("button.shift-card")).toHaveCount(0, {
      timeout: 30000,
    });
    await expect(
      manager.getByRole("button", { name: "פרסום לצוות", exact: true }),
    ).toBeDisabled();
  });
});
