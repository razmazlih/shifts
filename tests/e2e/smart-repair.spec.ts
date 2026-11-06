import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { getCandidates } from '../../src/lib/scheduler';
import { localToISO } from '../../src/lib/time';
import type { Shift, WeekData } from '../../src/lib/types';

const WEEK = '2032-01-04';

test('smart scheduling repairs an overlap in the draft, reports changes and supports undo', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    const response = await context.request.fetch(path, { method, data, headers: { Origin: origin } });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  }
  await request('/api/auth/login', 'POST', {
    email: process.env.DEMO_ADMIN_EMAIL ?? 'admin@demo.local',
    password: process.env.DEMO_ADMIN_PASSWORD ?? 'DemoAdmin!2026',
  });
  const initial = await request<WeekData>(`/api/weeks?week=${WEEK}`);
  const start = localToISO(WEEK, '07:00');
  const end = localToISO(WEEK, '15:00');
  const ids = [randomUUID(), randomUUID()].sort();
  const first: Shift = { id: ids[0], title: 'משמרת לתיקון חפיפה', group: 'MANAGERS', required: 1, start, end, assignments: [], note: 'הערה לשימור' };
  const eligible = getCandidates(first, [], initial.employees, initial.rules).filter(c => c.eligible);
  expect(eligible.length).toBeGreaterThanOrEqual(2);
  first.assignments = [{ employeeId: eligible[0].employee.id, start, end }];
  const second: Shift = { ...first, id: ids[1], title: 'משמרת חופפת לתיקון' };
  const before = await request<WeekData>('/api/weeks', 'PUT', {
    weekStart: WEEK, revision: initial.revision, shifts: [first, second],
  });
  expect(before.issues.some(i => i.code === 'OVERLAP')).toBe(true);
  await page.goto('/');
  await page.getByLabel('בחירת שבוע', { exact: true }).fill(WEEK);
  await expect(page.getByText(first.title, { exact: true })).toBeVisible();
  await expect(page.locator('.calendar-loading')).toBeHidden();
  await page.getByRole('button', { name: 'שיבוץ חכם', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'שיבוץ חכם ותיקון בעיות', exact: true });
  await expect(confirmation).toContainText('שיבוצים בעייתיים עשויים להשתנות');
  await confirmation.getByRole('button', { name: 'תיקון ושיבוץ', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.locator('.auto-result')).toContainText('הסידור תקין וכל המשמרות מכוסות');
  const after = await request<WeekData>(`/api/weeks?week=${WEEK}`);
  expect(after.issues).toEqual([]);
  expect(after.shifts[0]).toEqual(first);
  expect(after.shifts[1].assignments[0].employeeId).not.toBe(first.assignments[0].employeeId);
  expect(after.shifts.map(s => s.note)).toEqual([first.note, second.note]);
  expect(after.publishedRevision).toBe(before.publishedRevision);
  await page.getByText('אילו משמרות עודכנו?', { exact: true }).click();
  await expect(page.locator('.auto-result')).toContainText(second.title);
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/smart-repair.png', fullPage: true });
  await page.locator('.schedule-actions > summary').click();
  await page.getByRole('button', { name: 'ביטול השינוי האחרון', exact: true }).click();
  const undo = page.getByRole('dialog');
  await undo.getByRole('button', { name: 'ביטול שינוי', exact: true }).click();
  await expect(undo).toBeHidden();
  const restored = await request<WeekData>(`/api/weeks?week=${WEEK}`);
  expect(restored.shifts).toEqual(before.shifts);
});
