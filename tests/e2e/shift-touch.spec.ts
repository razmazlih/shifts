import { test, expect, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { Shift, WeekData } from '../../src/lib/types';
import { localDate, localTime, localToISO } from '../../src/lib/time';

const WEEK = '2031-01-05';
const PRECISE_TITLE = 'לילה עם דקות מדויקות בסוף השבוע';

async function expectTouchFields(editor: Locator) {
  const fields = editor.getByRole('region', { name: 'בחירת פרטי המשמרת', exact: true });
  await expect(fields).toBeVisible();
  // The optional custom-name disclosure can still support typing. The normal
  // create/edit path should expose pickers and buttons rather than keyboards.
  await expect(fields.locator('input:visible, textarea:visible')).toHaveCount(0);
  await expect(fields.getByRole('combobox')).toHaveCount(1);
  const dimensions = await editor.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return {
      content: el.scrollWidth,
      width: el.clientWidth,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
    };
  });
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
  expect(dimensions.left).toBeGreaterThanOrEqual(-1);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.viewportHeight + 1);
}

test('phone shift pickers create an overnight shift without typing and preserve precise existing times', async ({ browser, baseURL }) => {
  test.setTimeout(75_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    const response = await context.request.fetch(path, { method, data, headers: { Origin: origin } });
    expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
    return response.json();
  }
  try {
    await request('/api/auth/login', 'POST', {
      email: process.env.DEMO_ADMIN_EMAIL ?? 'admin@demo.local',
      password: process.env.DEMO_ADMIN_PASSWORD ?? 'DemoAdmin!2026',
    });
    const initial = await request<WeekData>(`/api/weeks?week=${WEEK}`);
    await request('/api/weeks', 'PUT', { weekStart: WEEK, revision: initial.revision, shifts: [] });
    await page.goto('/');
    await expect(page.getByLabel('בחירת שבוע', { exact: true })).toBeVisible();
    const loaded = page.waitForResponse(r => r.url().includes(`/api/weeks?week=${WEEK}`) && r.request().method() === 'GET');
    await page.getByLabel('בחירת שבוע', { exact: true }).fill(WEEK);
    await loaded;
    await expect(page.locator('.calendar-loading')).toBeHidden();
    await page.getByRole('button', { name: 'משמרת חדשה', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'משמרת חדשה', exact: true });
    await expectTouchFields(editor);
    await editor.getByRole('button', { name: 'משמרת לילה', exact: true }).click();
    await editor.getByRole('button', { name: 'סיורים', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'סיורים', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await editor.getByLabel('יום המשמרת', { exact: true }).selectOption(WEEK);
    await editor.locator('.shift-hours > summary').click();
    await editor.getByLabel('שעת התחלה', { exact: true }).selectOption('22');
    await editor.getByLabel('דקות התחלה', { exact: true }).selectOption('00');
    await editor.getByLabel('שעת סיום', { exact: true }).selectOption('06');
    await editor.getByLabel('דקות סיום', { exact: true }).selectOption('00');
    await expect(editor.getByLabel('יום סיום המשמרת', { exact: true })).toHaveValue('2031-01-06');
    await expect(editor.getByText('מסתיימת ביום הבא', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'הוספת עובד נדרש', exact: true }).click();
    await expect(editor.getByLabel('מספר עובדים נדרש', { exact: true })).toHaveText('2');
    await editor.locator('.shift-hours > summary').click();
    await expectTouchFields(editor);
    await expect(editor.getByPlaceholder('חיפוש עובד לשיבוץ')).toBeHidden();
    await expect(editor.getByRole('button', { name: 'שמירת משמרת', exact: true })).toBeInViewport();
    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({ path: 'output/playwright/shift-touch-mobile.png' });
    await editor.getByRole('button', { name: 'שמירת משמרת', exact: true }).click();
    await expect(editor).toBeHidden();
    const saved = await request<WeekData>(`/api/weeks?week=${WEEK}`);
    expect(saved.shifts).toHaveLength(1);
    expect(saved.shifts[0]).toMatchObject({ title: 'משמרת לילה', group: 'PATROL', required: 2 });
    expect(localDate(saved.shifts[0].start)).toBe(WEEK);
    expect(localTime(saved.shifts[0].start)).toBe('22:00');
    expect(localDate(saved.shifts[0].end)).toBe('2031-01-06');
    expect(localTime(saved.shifts[0].end)).toBe('06:00');

    // An existing Saturday shift can finish outside the selected week and use
    // arbitrary minutes. Merely opening and saving must never round or clamp it.
    const precise: Shift = {
      id: randomUUID(), title: PRECISE_TITLE, group: 'PATROL', required: 1,
      start: localToISO('2031-01-11', '23:17'),
      end: localToISO('2031-01-12', '06:43'), assignments: [], note: 'הערה קיימת נשמרת גם כשהיא סגורה',
    };
    await request('/api/weeks', 'PUT', { weekStart: WEEK, revision: saved.revision, shifts: [...saved.shifts, precise] });
    const refreshed = page.waitForResponse(r => r.url().includes(`/api/weeks?week=${WEEK}`) && r.request().method() === 'GET');
    await page.getByRole('button', { name: 'רענון הלוח', exact: true }).click();
    await refreshed;
    await page.locator('button.shift-card').filter({ has: page.getByText(PRECISE_TITLE, { exact: true }) }).click();
    const edit = page.getByRole('dialog', { name: 'פרטי המשמרת', exact: true });
    await expectTouchFields(edit);
    await expect(edit.getByLabel('יום תחילת המשמרת', { exact: true })).toHaveValue('2031-01-11');
    await expect(edit.getByLabel('שעת התחלה', { exact: true })).toHaveValue('23');
    await expect(edit.getByLabel('דקות התחלה', { exact: true })).toHaveValue('17');
    await expect(edit.getByLabel('יום סיום המשמרת', { exact: true })).toHaveValue('2031-01-12');
    await expect(edit.getByLabel('שעת סיום', { exact: true })).toHaveValue('06');
    await expect(edit.getByLabel('דקות סיום', { exact: true })).toHaveValue('43');
    await edit.getByRole('button', { name: 'שמירת משמרת', exact: true }).click();
    await expect(edit).toBeHidden();
    const final = await request<WeekData>(`/api/weeks?week=${WEEK}`);
    expect(final.shifts.find(s => s.id === precise.id)).toMatchObject({
      title: PRECISE_TITLE, start: precise.start, end: precise.end, required: 1, note: precise.note,
    });
  } finally {
    await context.close();
  }
});
