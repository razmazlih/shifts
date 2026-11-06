import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  request as requestFactory,
  type APIRequestContext,
} from "@playwright/test";
import { localToISO } from "../../src/lib/time";
import type { Employee, Shift, WeekData } from "../../src/lib/types";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const week = "2030-08-04";
const data = (value: unknown) => ({
  data: value,
  headers: { Origin: baseURL },
});
let admin: APIRequestContext;
let worker: APIRequestContext;
let stranger: APIRequestContext;

test.beforeAll(async () => {
  admin = await requestFactory.newContext({ baseURL });
  worker = await requestFactory.newContext({ baseURL });
  stranger = await requestFactory.newContext({ baseURL });
  const response = await admin.post(
    "/api/auth/login",
    data({
      email: "admin@demo.local",
      password: process.env.DEMO_ADMIN_PASSWORD ?? "DemoAdmin!2026",
    }),
  );
  expect(response.status(), await response.text()).toBe(200);
});
test.afterAll(async () => {
  await Promise.all([admin?.dispose(), worker?.dispose(), stranger?.dispose()]);
});

test("employee accounts enforce roles, synchronize edits, protect private fields, and retain history after deactivation", async () => {
  const unique = randomUUID().replaceAll("-", "");
  const email = `employee-${unique}@integration.invalid`;
  const newEmail = `updated-${unique}@integration.invalid`;
  const password = `Employee!${unique}`;
  let employee: Employee;
  let publishedShifts: Shift[];
  const fields: Omit<Employee, "id"> = {
    name: "עובדת בדיקה ייחודית",
    email,
    active: true,
    groups: ["PATROL"],
    maxWeeklyHours: 36,
    availability: [
      { day: 0, start: "07:00", end: "17:00" },
      { day: 2, start: "22:00", end: "06:00" },
    ],
    timeOff: [
      {
        start: localToISO("2030-08-05", "08:00"),
        end: localToISO("2030-08-05", "17:00"),
        reason: "סיבה פרטית שלא תיחשף לעובדים",
      },
    ],
    preferredDays: [0, 2],
  };

  await test.step("create an employee using the production schema and reject role injection", async () => {
    const roleInjection = await admin.post(
      "/api/employees",
      data({ employee: { ...fields, role: "ADMIN" }, password }),
    );
    expect(roleInjection.status()).toBe(400);
    const response = await admin.post(
      "/api/employees",
      data({ employee: fields, password }),
    );
    expect(response.status(), await response.text()).toBe(201);
    employee = (await response.json()).employee;
    expect(employee).toMatchObject(fields);
    expect(employee.id).toBeTruthy();
    expect(
      (
        await admin.post("/api/employees", data({ employee: fields, password }))
      ).status(),
    ).toBe(409);
    const login = await worker.post(
      "/api/auth/login",
      data({ email, password }),
    );
    expect(login.status(), await login.text()).toBe(200);
    expect((await login.json()).user).toMatchObject({
      role: "EMPLOYEE",
      employeeId: employee.id,
      name: fields.name,
    });
  });

  await test.step("publish a real assignment while private employee information stays admin-only", async () => {
    const start = localToISO(week, "08:00"),
      end = localToISO(week, "12:00");
    const shift: Shift = {
      id: `employee-history-${unique}`,
      title: "סיור היסטורי לעובדת בדיקה",
      group: "PATROL",
      start,
      end,
      required: 1,
      assignments: [{ employeeId: employee.id, start, end }],
      note: "הערת מנהל פרטית",
    };
    const before: WeekData = await (
      await admin.get(`/api/weeks?week=${week}`)
    ).json();
    const saved = await admin.put(
      "/api/weeks",
      data({ weekStart: week, revision: before.revision, shifts: [shift] }),
    );
    expect(saved.status(), await saved.text()).toBe(200);
    const draft: WeekData = await saved.json();
    const published = await admin.post(
      "/api/weeks/publish",
      data({ weekStart: week, revision: draft.revision, reviewToken: (await (await admin.get(`/api/weeks/publish?week=${week}`)).json()).reviewToken }),
    );
    expect(published.status(), await published.text()).toBe(200);
    publishedShifts = (await published.json()).shifts;
    const visible: WeekData = await (
      await worker.get(`/api/weeks?week=${week}`)
    ).json();
    expect(visible.shifts).toHaveLength(1);
    expect(visible.shifts[0]).not.toHaveProperty("note");
    expect(visible.shifts[0].assignments[0].employeeId).toBe(employee.id);
    for (const list of [
      visible.employees,
      (await (await worker.get("/api/employees")).json()).employees,
    ] as Employee[][]) {
      const safe = list.find((e) => e.id === employee.id)!;
      expect(safe).toMatchObject({
        id: employee.id,
        name: fields.name,
        groups: ["PATROL"],
        active: true,
        availability: [],
        timeOff: [],
        preferredDays: [],
        maxWeeklyHours: 0,
      });
      expect(safe).not.toHaveProperty("email");
    }
    expect(JSON.stringify(visible)).not.toContain(fields.timeOff[0].reason);
  });

  await test.step("employee mutations are forbidden and administrators cannot elevate the account through employee fields", async () => {
    expect(
      (
        await worker.post(
          "/api/employees",
          data({ employee: fields, password }),
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await worker.put(
          `/api/employees/${employee.id}`,
          data({ employee: { ...employee, name: "שינוי אסור" } }),
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await worker.put(
          `/api/employees/${employee.id}`,
          data({ employee: { ...employee, role: "ADMIN" } }),
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await admin.put(
          `/api/employees/${employee.id}`,
          data({ employee: { ...employee, role: "ADMIN" } }),
        )
      ).status(),
    ).toBe(400);
    expect((await stranger.get("/api/employees")).status()).toBe(401);
  });

  await test.step("name and email changes synchronize the linked login without changing its role", async () => {
    const changed = {
      ...employee,
      name: "נועה בדיקה לאחר עדכון",
      email: newEmail,
    };
    const response = await admin.put(
      `/api/employees/${employee.id}`,
      data({ employee: changed }),
    );
    expect(response.status(), await response.text()).toBe(200);
    employee = (await response.json()).employee;
    expect(employee.availability).toEqual(fields.availability);
    expect(employee.timeOff).toEqual(fields.timeOff);
    const me = await (await worker.get("/api/auth/me")).json();
    expect(me.user).toMatchObject({
      name: changed.name,
      role: "EMPLOYEE",
      employeeId: employee.id,
    });
    expect(
      (
        await stranger.post("/api/auth/login", data({ email, password }))
      ).status(),
    ).toBe(401);
    const login = await worker.post(
      "/api/auth/login",
      data({ email: newEmail, password }),
    );
    expect(login.status(), await login.text()).toBe(200);
    expect((await login.json()).user.role).toBe("EMPLOYEE");
  });

  await test.step("deactivation revokes existing sessions and preserves the published schedule and employee identity", async () => {
    const response = await admin.put(
      `/api/employees/${employee.id}`,
      data({ employee: { ...employee, active: false } }),
    );
    expect(response.status(), await response.text()).toBe(200);
    expect((await worker.get("/api/auth/me")).status()).toBe(401);
    expect((await worker.get(`/api/weeks?week=${week}`)).status()).toBe(401);
    expect(
      (
        await stranger.post(
          "/api/auth/login",
          data({ email: newEmail, password }),
        )
      ).status(),
    ).toBe(401);
    const retained: WeekData = await (
      await admin.get(`/api/weeks?week=${week}`)
    ).json();
    expect(retained.shifts).toEqual(publishedShifts);
    expect(retained.publishedRevision).not.toBeNull();
    expect(retained.employees.find((e) => e.id === employee.id)).toMatchObject({
      id: employee.id,
      name: employee.name,
      active: false,
    });
    const history = await (await admin.get(`/api/history?week=${week}`)).json();
    expect(
      history.history.some(
        (entry: { action: string }) => entry.action === "PUBLISH",
      ),
    ).toBe(true);
  });
});
