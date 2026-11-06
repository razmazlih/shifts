import { afterEach, describe, expect, it } from "vitest";
import {
  ApiError,
  body,
  checkOrigin,
  employeeFields,
  shiftsSchema,
  weekSchema,
} from "../src/lib/validation";
import { z } from "zod";
const originalURL = process.env.APP_URL;
afterEach(() => {
  if (originalURL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalURL;
});
function request(text: string, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/weeks", {
    method: "PUT",
    headers: { origin, "content-type": "application/json" },
    body: text,
  });
}
describe("mutation security and bounded validation", () => {
  it("requires an exact trusted origin; no origin and hostile origin fail", () => {
    process.env.APP_URL = "http://localhost:3000";
    expect(() => checkOrigin(request("{}"))).not.toThrow();
    expect(() => checkOrigin(request("{}", "https://hostile.example"))).toThrow(
      ApiError,
    );
    expect(() =>
      checkOrigin(
        new Request("http://localhost:3000/api/weeks", { method: "POST" }),
      ),
    ).toThrow(ApiError);
    expect(() =>
      checkOrigin(request("{}", "http://localhost:3000.hostile.example")),
    ).toThrow(ApiError);
  });
  it("enforces body size even without content-length and rejects malformed JSON", async () => {
    process.env.APP_URL = "http://localhost:3000";
    await expect(
      body(request("x".repeat(512 * 1024 + 1)), z.any()),
    ).rejects.toMatchObject({ status: 413 });
    await expect(body(request("{"), z.any())).rejects.toMatchObject({
      status: 400,
    });
  });
  it("rejects normalized invalid civil dates and non-Sunday week starts", () => {
    expect(weekSchema.safeParse("2026-02-29").success).toBe(false);
    expect(weekSchema.safeParse("2026-11-02").success).toBe(false);
    expect(weekSchema.safeParse("2026-11-01").success).toBe(true);
  });
  it("allows overnight availability and rejects equal start/end", () => {
    const employee = {
      name: "נועה",
      active: true,
      groups: ["PATROL"],
      maxWeeklyHours: 42,
      availability: [{ day: 0, start: "22:00", end: "06:00" }],
      timeOff: [],
      preferredDays: [],
    };
    expect(employeeFields.safeParse(employee).success).toBe(true);
    employee.availability[0].end = "22:00";
    expect(employeeFields.safeParse(employee).success).toBe(false);
  });
  it("bounds assignment spans before scheduler validation and rejects duplicate shift IDs", () => {
    const shift = {
      id: "one",
      title: "סיור",
      group: "PATROL",
      start: "2026-11-01T07:00:00Z",
      end: "2026-11-01T15:00:00Z",
      required: 1,
      assignments: [
        {
          employeeId: "e1",
          start: "2026-11-01T07:00:00Z",
          end: "2099-11-01T07:00:00Z",
        },
      ],
    };
    expect(shiftsSchema.safeParse([shift]).success).toBe(false);
    shift.assignments[0].end = shift.end;
    expect(shiftsSchema.safeParse([shift]).success).toBe(true);
    expect(shiftsSchema.safeParse([shift, shift]).success).toBe(false);
  });
});
