import { test, expect, request as requestFactory, type APIRequestContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { localToISO, weekStart } from "../../src/lib/time";
import type { Employee, Shift, WeekData } from "../../src/lib/types";
import type { PersonalUpdate, PersonalUpdatesPage } from "../../src/lib/publication-notifications";
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const week = weekStart("2041-06-02");
const payload = (data: unknown) => ({ data, headers: { Origin: baseURL } });
async function json<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json() as Promise<T>;
}

test("personal publication updates are durable, scoped, deduplicated and distinguish opening from explicit acknowledgement", async ({ page, context }) => {
  test.setTimeout(90000);
  const admin = await requestFactory.newContext({ baseURL }), other = await requestFactory.newContext({ baseURL });
  const people: Employee[] = [];
  const password = "OnlyLocalFixture!2037";
  const read = () => admin.get(`/api/weeks?week=${week}`).then(json<WeekData>);
  const updates = (client: APIRequestContext) => client.get("/api/me/updates").then(json<PersonalUpdatesPage>);
  const save = async (shifts: Shift[]) => {
    const current = await read(); return json<WeekData>(await admin.put("/api/weeks", payload({ weekStart: week, revision: current.revision, shifts })));
  };
  const publish = async () => {
    const current = await read(), review = await json<{ reviewToken: string }>(await admin.get(`/api/weeks/publish?week=${week}`));
    const body = { weekStart: week, revision: current.revision, reviewToken: review.reviewToken };
    const result = await json<WeekData>(await admin.post("/api/weeks/publish", payload(body)));
    return { result, body };
  };
  try {
    await json(await admin.post("/api/auth/login", payload({ email: "admin@demo.local", password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026" })));
    for (const suffix of ["a", "b"]) {
      const email = `update-${suffix}-${randomUUID()}@example.invalid`;
      const { employee } = await json<{ employee: Employee }>(await admin.post("/api/employees", payload({
        employee: { name: `עובד עדכונים ${suffix}`, email, active: true, groups: ["PATROL"], maxWeeklyHours: 42, availability: [], timeOff: [], preferredDays: [] }, password,
      })));
      people.push(employee);
      await json(await (suffix === "a" ? context.request : other).post("/api/auth/login", payload({ email, password })));
    }
    const start = localToISO(week, "08:00"), end = localToISO(week, "12:00");
    const first: Shift = { id: randomUUID(), title: "סיור עדכונים אישי", group: "PATROL", required: 2, start, end, note: "PRIVATE_MANAGER_NOTE",
      assignments: people.map(employee => ({ employeeId: employee.id, start, end })) };
    await save([first]);
    expect((await updates(context.request)).updates).toEqual([]);
    await publish();
    const firstA = (await updates(context.request)).updates[0], firstB = (await updates(other)).updates[0];
    expect(firstA.changes[0].kind).toBe("added"); expect(firstB.changes[0].kind).toBe("added");
    expect(firstA.openedAt).toBeNull(); expect(firstA.acknowledgedAt).toBeNull();
    const secretCheck = JSON.stringify(firstA);
    for (const secret of [people[1].id, people[1].name, "PRIVATE_MANAGER_NOTE", "locked", "employeeId"])
      expect(secretCheck).not.toContain(secret);
    expect((await other.patch("/api/me/updates", payload({ id: firstA.id, action: "acknowledge" }))).status()).toBe(404);
    expect((await other.get(`/api/me/updates?cursor=${firstA.id}`)).status()).toBe(404);
    expect((await admin.get("/api/me/updates")).status()).toBe(403);

    const second: Shift = { ...first, id: randomUUID(), title: "סיור עמית", required: 1, assignments: [first.assignments[1]] };
    const personal: Shift = { ...first, required: 1, end: localToISO(week, "11:00"), assignments: [{ ...first.assignments[0], end: localToISO(week, "11:00") }] };
    // First establish independent source records, then change A only.
    await save([{ ...first, required: 1, assignments: [first.assignments[0]] }, second]); await publish();
    const baselineB = (await updates(other)).updates.length;
    const beforeDraftA = (await updates(context.request)).updates.length;
    await save([personal, second]);
    expect((await updates(context.request)).updates.length).toBe(beforeDraftA);
    const published = await publish();
    const currentA = await updates(context.request);
    expect(currentA.updates.length).toBe(beforeDraftA + 1);
    expect(currentA.updates[0].changes).toHaveLength(1); expect(currentA.updates[0].changes[0].kind).toBe("changed");
    expect((await updates(other)).updates.length).toBe(baselineB);
    expect((await admin.post("/api/weeks/publish", payload(published.body))).status()).toBe(409);
    expect((await updates(context.request)).updates.length).toBe(currentA.updates.length);
    await save([{ ...personal, note: "changed private note", assignments: personal.assignments.map(assignment => ({ ...assignment, locked: true })) }, second]); await publish();
    expect((await updates(context.request)).updates.length).toBe(currentA.updates.length);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "עדכונים בסידור שלי" })).toBeVisible();
    const latest = page.locator(".personal-update").first();
    await latest.locator("summary").click();
    await expect(latest).toContainText("נפתח · טרם אושר שקראתי");
    const opened = (await updates(context.request)).updates[0];
    expect(opened.openedAt).not.toBeNull(); expect(opened.acknowledgedAt).toBeNull();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator(".sidebar").evaluate(element => element.getBoundingClientRect().left)).toBeGreaterThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await mkdir("output/playwright/stage-b", { recursive: true });
    await page.locator(".employee-updates").screenshot({ path: "output/playwright/stage-b/personal-updates-390.png", animations: "disabled" });
    await page.route("**/api/me/updates", route => route.request().method() === "PATCH" ? route.abort("failed") : route.continue());
    await latest.getByRole("button", { name: "קראתי", exact: true }).click();
    await expect(latest).toContainText("לא נשמר");
    expect((await updates(context.request)).updates[0].acknowledgedAt).toBeNull();
    await page.unroute("**/api/me/updates");
    await latest.getByRole("button", { name: "קראתי", exact: true }).click();
    await expect(latest).toContainText("אושר שקראתי");
    const acknowledged = (await updates(context.request)).updates[0];
    expect(acknowledged.acknowledgedAt).not.toBeNull(); expect(acknowledged.openedAt).toBe(opened.openedAt);
    const repeated = await json<{ update: PersonalUpdate }>(await context.request.patch("/api/me/updates", payload({ id: acknowledged.id, action: "acknowledge" })));
    expect(repeated.update.acknowledgedAt).toBe(acknowledged.acknowledgedAt);
    await page.reload(); await expect(page.locator(".personal-update").first()).toContainText("אושר שקראתי");

    await save([second]); await publish();
    const canceled = (await updates(context.request)).updates[0]; expect(canceled.changes[0].kind).toBe("canceled");
    expect((await updates(other)).updates.length).toBe(baselineB);
  } finally {
    for (const employee of people) await admin.put(`/api/employees/${employee.id}`, payload({ employee: { ...employee, active: false } }));
    await admin.dispose(); await other.dispose();
  }
});
