import { expect, test, type Page } from "@playwright/test";

const previewButton = (page: Page) => page.getByRole("button", { name: "יצירת הצעה לבדיקה", exact: true });
const options = (page: Page) => page.getByText("אפשרויות נוספות", { exact: true });

test("default is one action, with unchanged fill scope and separate review/apply", async ({ page }) => {
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/**", async route => {
    const body = route.request().postDataJSON();
    requests.push({ method: route.request().method(), body });
    await route.fulfill({ json: route.request().url().endsWith("/apply") ? {} : { id: "proposal-1", shifts: [], changes: [], issues: [], summary: { addedAssignments: 1, changedAssignments: 0, unchangedAssignments: 2, unfilledShifts: 0 } } });
  });
  await page.goto("/");
  await expect(page.getByLabel("סיכום הבחירה")).toContainText("כל השבוע (1.11–7.11) · אחמ״שים וסיורים");
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(previewButton(page)).toBeEnabled();
  await previewButton(page).click();
  await expect(page.getByRole("dialog", { name: "תצוגה מקדימה לשיבוץ" })).toBeVisible();
  expect(requests).toEqual([{ method: "POST", body: { weekStart: "2026-11-01", revision: 7, mode: "fill", scope: { days: [0, 1, 2, 3, 4, 5, 6], groups: ["MANAGERS", "PATROL"] } } }]);
  await page.getByRole("button", { name: "החלה על הטיוטה", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests[1]).toEqual({ method: "POST", body: { proposalId: "proposal-1" } });
});

test("advanced selection stays explicit after collapsing and invalid scope is explained", async ({ page }) => {
  await page.goto("/");
  await options(page).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("checkbox", { name: "כל השבוע", exact: true }).uncheck();
  await expect(previewButton(page)).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "בחרו לפחות יום" })).toBeVisible();
  await page.getByRole("checkbox", { name: "יום שלישי, 3.11", exact: true }).check();
  await page.getByRole("checkbox", { name: "אחמ״שים", exact: true }).uncheck();
  await page.getByRole("radio", { name: /תיקון שיבוצים/ }).check();
  await options(page).click();
  const summary = page.getByLabel("סיכום הבחירה");
  await expect(summary).toContainText("יום שלישי, 3.11 · סיורים");
  await expect(summary).toContainText("תיקון שיבוצים");
  await expect(summary).toContainText("עשויים להשתנות");
  await expect(previewButton(page)).toBeEnabled();
  await options(page).click();
  await page.getByRole("checkbox", { name: "סיורים", exact: true }).uncheck();
  await expect(previewButton(page)).toBeDisabled();
  await expect(summary).toContainText("לא נבחרו צוותים");
});

test("template controls retain keyboard focus and selected daily scope", async ({ page }) => {
  await page.goto("/");
  await options(page).click();
  const select = page.getByLabel("תבנית לשבוע", { exact: true });
  await select.focus();
  await select.selectOption("daily");
  await expect(select).toBeFocused();
  await expect(page.getByRole("checkbox", { name: "יום ראשון, 1.11", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "כל השבוע", exact: true })).not.toBeChecked();
  await options(page).click();
  await expect(page.getByLabel("סיכום הבחירה")).toContainText("תבנית: יום רגיל");
  await options(page).click();
  await select.focus();
  await select.selectOption("");
  await expect(select).toBeFocused();
  await expect(page.getByRole("checkbox", { name: "יום ראשון, 1.11", exact: true })).toBeChecked();
});

test("empty week presents template selection, including inherited day and team", async ({ page }) => {
  await page.goto("/?empty");
  await expect(page.getByText("השבוע עדיין ריק. בחרו תבנית כדי להתחיל.")).toBeVisible();
  await expect(page.getByLabel("תבנית לשבוע", { exact: true })).toBeVisible();
  await expect(previewButton(page)).toBeDisabled();
  await page.getByLabel("תבנית לשבוע", { exact: true }).selectOption("weekly");
  await expect(previewButton(page)).toBeEnabled();
  await expect(page.getByLabel("סיכום הבחירה")).toContainText("כל השבוע");
  await page.goto("/?empty&template=daily&target=3&group=PATROL");
  await expect(page.getByLabel("סיכום הבחירה")).toContainText("יום רביעי, 4.11 · סיורים");
  await expect(previewButton(page)).toBeEnabled();
  await page.goto("/?empty&noTemplates&templateError");
  await expect(page.getByRole("alert")).toContainText("לא ניתן לטעון תבניות");
  await expect(previewButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "יצירת תבנית", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("יצירת תבנית נפתחה");
});

test("pending requests cannot duplicate or dismiss; errors allow retry and review can return", async ({ page }) => {
  let calls = 0;
  let release: (() => void) | undefined;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/weeks/auto", async route => {
    if (route.request().method() === "DELETE") { await route.fulfill({ json: {} }); return; }
    calls++;
    if (calls === 1) {
      await blocked;
      await route.fulfill({ status: 409, json: { error: "השבוע השתנה. נסו שוב." } });
    } else await route.fulfill({ json: { id: "retry-proposal", shifts: [], changes: [], issues: [], summary: { addedAssignments: 0, changedAssignments: 0, unchangedAssignments: 0, unfilledShifts: 1 } } });
  });
  await page.goto("/");
  await previewButton(page).click();
  await expect(page.getByRole("button", { name: "בודק…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "סגירה", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(calls).toBe(1);
  release!();
  await expect(page.getByRole("alert")).toContainText("השבוע השתנה");
  await previewButton(page).click();
  await page.getByRole("button", { name: "שינוי הבחירה", exact: true }).click();
  await expect(previewButton(page)).toBeEnabled();
  await page.getByRole("button", { name: "ביטול", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "פתיחת שיבוץ" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const width of [360, 390, 1440]) test(`RTL layout and actions fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const dialog = page.getByRole("dialog");
  const checkFits = async () => {
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const button = await previewButton(page).boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(844);
    expect(button!.x).toBeGreaterThanOrEqual(0);
    expect(button!.x + button!.width).toBeLessThanOrEqual(width);
  };
  await checkFits();
  await dialog.screenshot({ path: `output/smart-schedule-ui/simplified-${width}.png` });
  await options(page).click();
  await checkFits();
  await page.getByLabel("תבנית לשבוע", { exact: true }).scrollIntoViewIfNeeded();
  await checkFits();
});
