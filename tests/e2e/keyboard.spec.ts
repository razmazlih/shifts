import { expect, test } from "@playwright/test";

test("keyboard opens the shift editor, keeps focus inside and cancels without saving", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  const login = await context.request.post("/api/auth/login", { headers: { Origin: origin }, data: {
    email: "admin@demo.local", password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026",
  } });
  expect(login.ok()).toBe(true);
  await page.goto("/");
  const create = page.getByRole("button", { name: "משמרת חדשה", exact: true });
  await expect(create).toBeEnabled();
  const week = await page.getByLabel("בחירת שבוע", { exact: true }).inputValue();
  const before = await (await context.request.get(`/api/weeks?week=${week}`)).json();
  await create.focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "משמרת חדשה", exact: true });
  await expect(editor).toBeVisible();
  for (const key of ["Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(await editor.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  const after = await (await context.request.get(`/api/weeks?week=${week}`)).json();
  expect(after.revision).toBe(before.revision);
  expect(after.shifts).toEqual(before.shifts);

  // Check reflow in the CSS viewport corresponding to a 1440x1000 content
  // area at 200% browser zoom. CSS root zoom is not equivalent: it keeps
  // viewport units/media queries at their original size and scales the fixed
  // dialog beyond that viewport. This checks logical viewport reflow, not
  // browser zoom controls, a physical phone keyboard, or pinch zoom.
  await page.setViewportSize({ width: 720, height: 500 });
  await create.click();
  await expect(editor).toBeVisible();
  const save = editor.getByRole("button", { name: "שמירת משמרת", exact: true });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport({ ratio: 1 });
  await expect(editor.getByRole("button", { name: "ביטול", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
});
