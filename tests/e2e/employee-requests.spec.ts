import { randomUUID } from "node:crypto";
import { expect, test, request as requestFactory, type APIRequestContext } from "@playwright/test";
import { localToISO, weekStart } from "../../src/lib/time";
import type { Employee, Shift, WeekData } from "../../src/lib/types";
import type { EmployeeRequestView } from "../../src/lib/employee-requests";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const week = weekStart("2040-02-01");
const data = (value: unknown) => ({ data: value, headers: { Origin: baseURL } });
let admin: APIRequestContext, worker: APIRequestContext, other: APIRequestContext;
let person: Employee;
const start = localToISO(week, "08:00"), end = localToISO(week, "12:00");
async function readWeek(client = admin): Promise<WeekData> { return (await client.get(`/api/weeks?week=${week}`)).json(); }
async function readEmployee(): Promise<Employee> { return (await (await admin.get("/api/employees")).json()).employees.find((value: Employee) => value.id === person.id); }

test.beforeAll(async () => {
  admin = await requestFactory.newContext({ baseURL }); worker = await requestFactory.newContext({ baseURL }); other = await requestFactory.newContext({ baseURL });
  const login = await admin.post("/api/auth/login", data({ email: "admin@demo.local", password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026" }));
  expect(login.status(), await login.text()).toBe(200);
  for (const [index, client] of [worker, other].entries()) {
    const unique = randomUUID().replaceAll("-", ""), email = `requests-${unique}@integration.invalid`, password = `Requests!${unique}`;
    const created = await admin.post("/api/employees", data({ employee: { name: `עובד בדיקת בקשות ${index + 1}`, email, active: true, groups: ["PATROL"], maxWeeklyHours: 42, availability: [], timeOff: [], preferredDays: [] }, password }));
    expect(created.status(), await created.text()).toBe(201);
    if (index === 0) person = (await created.json()).employee;
    expect((await client.post("/api/auth/login", data({ email, password }))).status()).toBe(200);
  }
  const current = await readWeek();
  const shift: Shift = { id: randomUUID(), title: "סיור לבדיקת בקשת היעדרות", group: "PATROL", start, end, required: 1, assignments: [{ employeeId: person.id, start, end }] };
  const saved = await admin.put("/api/weeks", data({ weekStart: week, revision: current.revision, shifts: [shift] }));
  expect(saved.status(), await saved.text()).toBe(200);
  const draft: WeekData = await saved.json();
  const review = await (await admin.get(`/api/weeks/publish?week=${week}`)).json();
  const published = await admin.post("/api/weeks/publish", data({ weekStart: week, revision: draft.revision, reviewToken: review.reviewToken }));
  expect(published.status(), await published.text()).toBe(200);
});
test.afterAll(async () => { await admin?.dispose(); await worker?.dispose(); await other?.dispose(); });

test("own-only requests, exact-once retries, atomic approval/withdrawal and concurrent decisions preserve publication", async () => {
  const draftBefore = await readWeek(), publishedBefore = await readWeek(worker), employeeBefore = await readEmployee();
  const payload = { submissionKey: randomUUID(), kind: "CONSTRAINT", start, end, reason: "סיבה פרטית של העובד הראשון" };
  const tooLong = await worker.post("/api/requests", data({ ...payload, reason: "א".repeat(501) }));
  expect(tooLong.status()).toBe(400);
  const submitted = await worker.post("/api/requests", data(payload));
  expect(submitted.status(), await submitted.text()).toBe(201);
  const request: EmployeeRequestView = (await submitted.json()).request;
  const retry = await worker.post("/api/requests", data(payload));
  expect((await retry.json()).request.id).toBe(request.id);
  const strangerRequest: EmployeeRequestView = (await (await other.post("/api/requests", data({ ...payload, submissionKey: randomUUID(), reason: "סיבה פרטית של עובד אחר" }))).json()).request;
  expect((await worker.get(`/api/requests?id=${strangerRequest.id}`)).status()).toBe(404);
  expect((await worker.patch("/api/requests", data({ id: strangerRequest.id, revision: 0, action: "cancel" }))).status()).toBe(404);
  expect((await worker.patch("/api/requests", data({ id: request.id, revision: 0, action: "approve" }))).status()).toBe(403);
  const ownList = await (await worker.get("/api/requests")).json();
  expect(ownList.requests).toHaveLength(1);
  expect(JSON.stringify(ownList)).not.toContain("סיבה פרטית של עובד אחר");
  expect(JSON.stringify(ownList)).not.toContain("impacts");
  expect((await readWeek()).shifts).toEqual(draftBefore.shifts);
  expect((await readWeek()).revision).toBe(draftBefore.revision);
  expect((await readWeek(worker)).shifts).toEqual(publishedBefore.shifts);
  expect((await readEmployee()).timeOff).toEqual(employeeBefore.timeOff);
  const managerRequest: EmployeeRequestView = (await (await admin.get(`/api/requests?id=${request.id}`)).json()).requests[0];
  expect(managerRequest.impacts?.map(item => item.source).sort()).toEqual(["draft", "published"]);

  const decisions = await Promise.all([admin.patch("/api/requests", data({ id: request.id, revision: 0, action: "approve", decisionNote: "אושר לבדיקה" })), admin.patch("/api/requests", data({ id: request.id, revision: 0, action: "approve" }))]);
  expect(decisions.map(response => response.status()).sort()).toEqual([200, 409]);
  const approved: EmployeeRequestView = (await (await worker.get(`/api/requests?id=${request.id}`)).json()).requests[0];
  expect(approved.status).toBe("APPROVED"); expect(approved.history).toHaveLength(2);
  expect((await worker.patch("/api/requests", data({ id: request.id, revision: approved.revision, action: "cancel" }))).status()).toBe(409);
  const constrained = await readEmployee();
  expect(constrained.timeOff.filter(item => item.requestId === request.id)).toHaveLength(1);
  expect((await readWeek()).issues.some(issue => issue.code === "TIME_OFF" && issue.employeeId === person.id)).toBe(true);
  expect((await readWeek(worker)).shifts).toEqual(publishedBefore.shifts);
  expect((await readWeek()).shifts).toEqual(draftBefore.shifts);
  expect((await admin.put(`/api/employees/${person.id}`, data({ employee: { ...employeeBefore, name: "עריכה ישנה" } }))).status()).toBe(409);
  const preserved = await admin.put(`/api/employees/${person.id}`, data({ employee: { ...constrained, timeOff: [] } }));
  expect(preserved.status(), await preserved.text()).toBe(200);
  person = (await preserved.json()).employee;
  expect(person.timeOff.some(item => item.requestId === request.id)).toBe(true);
  const forged = await admin.put(`/api/employees/${person.id}`, data({ employee: { ...person, timeOff: [{ start, end, requestId: "forged-request" }] } }));
  expect(forged.status()).toBe(409);
  const manual = { start, end, reason: "אילוץ ידני נפרד" };
  const added = await admin.put(`/api/employees/${person.id}`, data({ employee: { ...person, timeOff: [...person.timeOff, manual] } }));
  expect(added.status(), await added.text()).toBe(200);
  const cancelled = await admin.patch("/api/requests", data({ id: request.id, revision: approved.revision, action: "cancel", decisionNote: "ביטול אישור לבדיקה" }));
  expect(cancelled.status(), await cancelled.text()).toBe(200);
  const final: EmployeeRequestView = (await cancelled.json()).request;
  expect(final.status).toBe("CANCELLED"); expect(final.history.map(event => event.status)).toEqual(["PENDING", "APPROVED", "CANCELLED"]);
  expect((await readEmployee()).timeOff).toEqual([manual]);
  expect((await readWeek(worker)).shifts).toEqual(publishedBefore.shifts);
  expect((await other.patch("/api/requests", data({ id: strangerRequest.id, revision: 0, action: "cancel" }))).status()).toBe(200);
});

test("request UI retains failed input, saves after retry and supports manager approval without changing publication", async ({ page, browser }) => {
  await page.context().addCookies((await worker.storageState()).cookies);
  await page.goto("/");
  await page.locator(".personal-shortcuts").getByRole("button", { name: "הבקשות שלי", exact: true }).click();
  const panel = page.locator(".requests-panel");
  await panel.getByLabel("תאריך התחלה", { exact: true }).fill(week);
  await panel.getByLabel("תאריך סיום", { exact: true }).fill(week);
  await panel.getByLabel("הסבר למנהל (לא חובה)").fill("הפרטים נשארים בטופס אחרי כשל רשת");
  await page.route("**/api/requests", route => route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue());
  await panel.getByRole("button", { name: "שליחת בקשה", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("לא נשמר");
  await expect(panel.getByLabel("הסבר למנהל (לא חובה)")).toHaveValue("הפרטים נשארים בטופס אחרי כשל רשת");
  await page.unroute("**/api/requests");
  await panel.getByRole("button", { name: "שליחת בקשה", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("הבקשה נשמרה וממתינה");
  await expect(panel.getByLabel("הסבר למנהל (לא חובה)")).toHaveValue("");
  await expect(panel.getByTestId("employee-request").filter({ hasText: "הפרטים נשארים בטופס" })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect.poll(() => page.locator(".sidebar").evaluate(element => element.getBoundingClientRect().left >= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/screenshots/employee-requests-390.png", fullPage: true, animations: "disabled" });
  const publishedBefore = await readWeek(worker);
  const submitted: EmployeeRequestView = (await (await worker.get("/api/requests")).json()).requests.find((value: EmployeeRequestView) => value.reason === "הפרטים נשארים בטופס אחרי כשל רשת");
  const managerContext = await browser.newContext({ baseURL, storageState: await admin.storageState() });
  try {
    const managerPage = await managerContext.newPage();
    await managerPage.goto("/");
    await managerPage.getByRole("button", { name: "בקשות עובדים", exact: true }).click();
    const managerPanel = managerPage.locator(".requests-panel");
    const card = managerPanel.getByTestId("employee-request").filter({ hasText: "הפרטים נשארים בטופס אחרי כשל רשת" }).first();
    await expect(card.getByRole("region", { name: "שיבוצים מושפעים" })).toContainText("סיור לבדיקת בקשת היעדרות");
    await card.screenshot({ path: "docs/screenshots/manager-request-review.png", animations: "disabled" });
    await card.getByRole("button", { name: "אישור הבקשה", exact: true }).click();
    await expect(managerPanel.getByRole("status")).toContainText("הבקשה אושרה והאילוץ נשמר");
    const approved: EmployeeRequestView = (await (await worker.get(`/api/requests?id=${submitted.id}`)).json()).requests[0];
    expect(approved.status).toBe("APPROVED");
    expect((await readWeek(worker)).shifts).toEqual(publishedBefore.shifts);
    expect((await readEmployee()).timeOff.some(item => item.requestId === submitted.id)).toBe(true);
    await panel.getByRole("button", { name: "רענון בקשות", exact: true }).click();
    await expect(panel.getByTestId("employee-request").filter({ hasText: "הפרטים נשארים בטופס אחרי כשל רשת" }).locator(".request-status")).toHaveText("אושר");
  } finally { await managerContext.close(); }
});
