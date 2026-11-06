import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { localToISO } from "../src/lib/time";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getWeekData: vi.fn() }));
vi.mock("../src/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("../src/lib/weeks", () => ({ getWeekData: mocks.getWeekData }));
import { GET } from "../src/app/api/export/route";

const week = "2030-08-04";
const start = localToISO(week, "22:00"), end = localToISO("2030-08-05", "06:00");
const admin = { id: "admin", role: "ADMIN", employeeId: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(admin);
  mocks.getWeekData.mockImplementation(async (_week, _user, version) => ({
    publishedRevision: 2,
    employees: [{ id: "e", name: "עובד בדיקה" }],
    shifts: [{ id: "s", title: version === "published" ? "סיור שפורסם" : "סיור טיוטה", group: "PATROL", start, end, required: 1, assignments: [{ employeeId: "e", start, end }] }],
  }));
});

async function workbook(response: Response) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer);
  return book;
}
describe("explicit sharing version", () => {
  it("defaults Excel to the published snapshot", async () => {
    const response = await GET(new Request(`http://localhost/api/export?week=${week}`));
    expect(response.status).toBe(200);
    expect(mocks.requireUser).toHaveBeenCalledWith(true);
    expect(mocks.getWeekData).toHaveBeenCalledWith(week, admin, "published");
    const book = await workbook(response);
    const content = JSON.stringify(book.worksheets.map((sheet) => sheet.getSheetValues()));
    expect(content).toContain("סיור שפורסם");
    expect(content).not.toContain("סיור טיוטה");
    expect(response.headers.get("Content-Disposition")).toContain("published.xlsx");
  });

  it("marks explicit drafts in each worksheet and printed page header", async () => {
    const response = await GET(new Request(`http://localhost/api/export?week=${week}&version=draft`));
    expect(response.status).toBe(200);
    const book = await workbook(response);
    for (const sheet of book.worksheets) {
      expect(sheet.getCell("A1").text).toContain("טיוטת מנהל — לא פורסמה לצוות");
      expect(sheet.headerFooter.oddHeader).toContain("טיוטת מנהל");
    }
    expect(JSON.stringify(book.worksheets[1].getSheetValues())).toContain("סיור טיוטה");
  });

  it("does not represent an unpublished empty week as a published export", async () => {
    mocks.getWeekData.mockResolvedValueOnce({ publishedRevision: null, shifts: [], employees: [] });
    const response = await GET(new Request(`http://localhost/api/export?week=${week}`));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("אין סידור שפורסם");
  });
});
