import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { WeekData } from "../../src/lib/types";

const WEEK = "2030-09-01";
const INITIAL_TITLE = "מנהל בנייד · משמרת בוקר";
const UPDATED_TITLE = "מנהל בנייד · בוקר מעודכן";

async function assertFitsPhone(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.page,
    "The manager workflow must not scroll horizontally on a 360px phone",
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    const size = await dialog.evaluate((el) => ({
      width: el.clientWidth,
      content: el.scrollWidth,
    }));
    expect(
      size.content,
      "Dialog fields must remain inside the phone viewport",
    ).toBeLessThanOrEqual(size.width + 1);
    await expect
      .poll(
        () =>
          dialog.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.left >= -1 &&
              r.top >= -1 &&
              r.right <= document.documentElement.clientWidth + 1 &&
              r.bottom <= document.documentElement.clientHeight + 1
            );
          }),
        {
          message:
            "The complete editor and its actions must fit the phone viewport",
        },
      )
      .toBe(true);
  }
}

test("360px manager can create, assign, edit, publish and open employee management", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  async function request<T>(
    client: APIRequestContext,
    path: string,
    method = "GET",
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
  try {
    await request(context.request, "/api/auth/login", "POST", {
      email: process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.local",
      password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026",
    });
    const existing = await request<WeekData>(
      context.request,
      `/api/weeks?week=${WEEK}`,
    );
    await request(context.request, "/api/weeks", "PUT", {
      weekStart: WEEK,
      revision: existing.revision,
      shifts: [],
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "לוח משמרות", level: 1 }),
    ).toBeVisible();
    const picker = page.getByLabel("בחירת שבוע", { exact: true });
    await expect(picker).toBeVisible();
    const weekResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/weeks?week=${WEEK}`) &&
        r.request().method() === "GET",
    );
    await picker.fill(WEEK);
    await weekResponse;
    await expect(page.locator(".calendar-loading")).toBeHidden();
    await assertFitsPhone(page);

    const create = page.getByRole("button", {
      name: "משמרת חדשה",
      exact: true,
    });
    expect(
      (await create.boundingBox())!.height,
      "Primary phone actions need a 44px touch target",
    ).toBeGreaterThanOrEqual(44);
    await create.click();
    const editor = page.getByRole("dialog", {
      name: "משמרת חדשה",
      exact: true,
    });
    await editor.locator(".shift-hours > summary").click();
    await editor.getByLabel("שם המשמרת", { exact: true }).fill(INITIAL_TITLE);
    await editor.locator(".shift-staff > summary").click();
    await expect(
      editor.locator("button.candidate:not([disabled])").first(),
    ).toBeVisible();
    await editor.locator("button.candidate:not([disabled])").first().click();
    await expect(editor.locator(".assignee-row")).toHaveCount(1);
    await assertFitsPhone(page);
    await mkdir("output/playwright", { recursive: true });
    await page.screenshot({
      path: "output/playwright/manager-mobile-modal.png",
    });
    await editor
      .getByRole("button", { name: "שמירת משמרת", exact: true })
      .click();
    await expect(editor).toBeHidden();
    const card = page
      .locator("button.shift-card")
      .filter({ has: page.getByText(INITIAL_TITLE, { exact: true }) });
    await expect(card).toHaveCount(1);
    await card.click();
    const edit = page.getByRole("dialog", { name: "פרטי המשמרת", exact: true });
    await edit.locator(".shift-hours > summary").click();
    await edit.getByLabel("שם המשמרת", { exact: true }).fill(UPDATED_TITLE);
    await edit
      .getByRole("button", { name: "שמירת משמרת", exact: true })
      .click();
    await expect(edit).toBeHidden();
    await page
      .getByRole("button", { name: "פרסום לצוות", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "בדיקה לפני פרסום",
      exact: true,
    });
    await confirmation
      .getByRole("button", { name: "פרסום לצוות", exact: true })
      .click();
    await expect(confirmation).toBeHidden();
    await expect(page.locator("button.shift-card")).toHaveCount(1);
    await expect(page.locator("button.shift-card")).toContainText(
      UPDATED_TITLE,
    );
    const published = await request<WeekData>(
      context.request,
      `/api/weeks?week=${WEEK}`,
    );
    expect(published.hasDraft).toBe(false);
    expect(published.shifts[0].assignments).toHaveLength(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertFitsPhone(page);
    await page.screenshot({
      path: "output/playwright/manager-mobile.png",
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "פתיחת תפריט", exact: true })
      .click();
    await page
      .locator("button.nav-item")
      .filter({ hasText: "אנשי הצוות" })
      .click();
    await expect(
      page.getByRole("heading", { name: "אנשי הצוות", level: 1 }),
    ).toBeVisible();
    await assertFitsPhone(page);
    await page.getByRole("button", { name: "הוספת עובד", exact: true }).click();
    const employee = page.getByRole("dialog", {
      name: "חבר צוות חדש",
      exact: true,
    });
    await expect(employee.getByLabel("שם מלא", { exact: true })).toBeVisible();
    await employee
      .getByLabel("שם מלא", { exact: true })
      .fill("בדיקת טופס בנייד");
    await expect(
      employee.getByLabel("כתובת אימייל", { exact: true }),
    ).toBeVisible();
    await assertFitsPhone(page);
    await employee.getByRole("button", { name: "ביטול", exact: true }).click();
    await expect(employee).toBeHidden();
    // Model a second phone before navigation, keeping its device screen and
    // viewport coherent rather than zooming a focused first device.
    const phone390 = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState: await context.storageState(),
    });
    try {
      const second = await phone390.newPage();
      await second.goto("/");
      await second
        .getByRole("button", { name: "פתיחת תפריט", exact: true })
        .click();
      await second
        .locator("button.nav-item")
        .filter({ hasText: "אנשי הצוות" })
        .click();
      await second
        .getByRole("button", { name: "הוספת עובד", exact: true })
        .click();
      const form = second.getByRole("dialog", {
        name: "חבר צוות חדש",
        exact: true,
      });
      await form.getByLabel("שם מלא", { exact: true }).fill("בדיקת טופס 390");
      await assertFitsPhone(second);
      await second.screenshot({
        path: "output/playwright/manager-mobile-employee-form.png",
      });
      await form.getByRole("button", { name: "ביטול", exact: true }).click();
      await expect(form).toBeHidden();
    } finally {
      await phone390.close();
    }
  } finally {
    await context.close();
  }
});
