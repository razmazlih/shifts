import ExcelJS from "exceljs";
import { requireUser } from "@/lib/auth";
import { getWeekData } from "@/lib/weeks";
import { route, weekSchema, ApiError } from "@/lib/validation";
import { GROUP_LABELS, type Group, type Shift } from "@/lib/types";
import { weekDates, localDate, localTime, addDays } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
function range(start: string, end: string) {
  const daysApart = Math.round(
    (Date.parse(`${localDate(end)}T00:00:00Z`) -
      Date.parse(`${localDate(start)}T00:00:00Z`)) /
      86400000,
  );
  return `${localTime(start)}–${localTime(end)}${daysApart ? ` (+${daysApart})` : ""}`;
}
export const GET = route(async (request) => {
  const user = await requireUser(true);
  const params = new URL(request.url).searchParams;
  const week = weekSchema.parse(params.get("week"));
  const version = params.get("version") ?? "draft";
  if (version !== "draft" && version !== "published")
    throw new ApiError(400, "גרסת ייצוא לא תקינה");
  const data = await getWeekData(week, user, version);
  const names = new Map(data.employees.map((e) => [e.id, e.name]));
  const book = new ExcelJS.Workbook();
  book.creator = "משמרת";
  book.created = new Date();
  const sheet = book.addWorksheet("סידור שבועי", {
    views: [{ rightToLeft: true }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sheet.columns = [
    { width: 17 },
    ...Array.from({ length: 7 }, () => ({ width: 29 })),
  ];
  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value =
    `משמרת · ${week} עד ${addDays(week, 6)} · ${version === "draft" ? "טיוטה" : "סידור שפורסם"}`;
  sheet.getRow(1).height = 32;
  sheet.getCell("A1").font = {
    bold: true,
    size: 16,
    color: { argb: "FF173A48" },
  };
  sheet.addRow([
    "קבוצה",
    ...weekDates(week).map((date, i) => `יום ${days[i]} · ${date}`),
  ]);
  for (const group of ["MANAGERS", "PATROL"] as Group[]) {
    const grouped = weekDates(week).map((date) =>
      data.shifts
        .filter((s) => s.group === group && localDate(s.start) === date)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    );
    const max = Math.max(1, ...grouped.map((a) => a.length));
    for (let index = 0; index < max; index++) {
      const row = sheet.addRow([
        index === 0 ? GROUP_LABELS[group] : "",
        ...grouped.map((list) => {
          const shift: Shift | undefined = list[index];
          if (!shift) return "";
          return `${shift.title}\n${range(shift.start, shift.end)}\n${shift.assignments.length ? shift.assignments.map((a) => `${names.get(a.employeeId) ?? "עובד"}${a.start !== shift.start || a.end !== shift.end ? ` (${range(a.start, a.end)})` : ""}`).join("\n") : "לא משובץ"}\nנדרשים: ${shift.required}`;
        }),
      ]);
      row.height = Math.min(
        409,
        Math.max(
          100,
          ...grouped.map(
            (list) => (list[index]?.assignments.length ?? 0) * 17 + 70,
          ),
        ),
      );
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: group === "MANAGERS" ? "FFEAF3F5" : "FFF1EDFA" },
        };
      });
    }
    sheet.addRow([]);
  }
  sheet.eachRow((row, index) =>
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", horizontal: "right", wrapText: true };
      cell.font = { name: "Arial", size: index === 1 ? 16 : 11, ...cell.font };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE0E8ED" } } };
      if (index === 2) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF173A48" },
        };
        cell.font = {
          bold: true,
          color: { argb: "FFFFFFFF" },
          name: "Arial",
          size: 11,
        };
      }
    }),
  );
  sheet.pageSetup.printTitlesRow = "1:2";
  const details = book.addWorksheet("פירוט שיבוצים", {
    views: [{ rightToLeft: true }],
  });
  details.columns = [
    { header: "תאריך", width: 15 },
    { header: "קבוצה", width: 16 },
    { header: "משמרת", width: 25 },
    { header: "התחלה", width: 24 },
    { header: "סיום", width: 24 },
    { header: "שם עובד", width: 24 },
    { header: "תחילת שיבוץ", width: 24 },
    { header: "סיום שיבוץ", width: 24 },
  ];
  const civil = (iso: string) => `${localDate(iso)} ${localTime(iso)}`;
  for (const s of data.shifts.toSorted(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  )) {
    for (const a of s.assignments.length ? s.assignments : [null])
      details.addRow([
        localDate(s.start),
        GROUP_LABELS[s.group],
        s.title,
        civil(s.start),
        civil(s.end),
        a ? (names.get(a.employeeId) ?? "עובד") : "לא משובץ",
        a ? civil(a.start) : "",
        a ? civil(a.end) : "",
      ]);
  }
  details.getRow(1).font = { bold: true };
  const bytes = await book.xlsx.writeBuffer();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="shifts-${week}-${version}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
});
