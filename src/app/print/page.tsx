import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getWeekData } from "@/lib/weeks";
import { weekSchema } from "@/lib/validation";
import { GROUP_LABELS, type Group } from "@/lib/types";
import {
  addDays,
  localDate,
  localTime,
  weekDates,
  weekStart,
} from "@/lib/time";
import { PrintControls } from "@/components/print-controls";
export const dynamic = "force-dynamic";
export const metadata = { title: "הדפסת סידור שבועי — משמרת" };
export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const parsed = weekSchema.safeParse(query.week ?? weekStart());
  if (!parsed.success)
    return <main style={{ padding: 40 }}>תאריך השבוע אינו תקין.</main>;
  const week = parsed.data;
  const version =
    user.role === "ADMIN" && query.version !== "published"
      ? "draft"
      : "published";
  const data = await getWeekData(week, user, version);
  const admin = user.role === "ADMIN";
  const teamScope = admin || query.scope === "team";
  const shifts = teamScope
    ? data.shifts
    : data.shifts.flatMap((shift) =>
        shift.assignments
          .filter((assignment) => assignment.employeeId === user.employeeId)
          .map((assignment, index) => ({
            ...shift,
            id: `${shift.id}-${index}`,
            start: assignment.start,
            end: assignment.end,
            assignments: [assignment],
          })),
      );
  const groups = (["MANAGERS", "PATROL"] as Group[]).filter(
    (group) => teamScope || shifts.some((shift) => shift.group === group),
  );
  const names = new Map(data.employees.map((e) => [e.id, e.name]));
  return (
    <main className="print-document">
      <style>{`
    .print-document{background:white;padding:30px;color:#17353c;min-height:100vh}.print-document h1{font-size:26px;margin:0}.print-document p{font-size:13px;margin:7px 0 20px}.print-controls{display:flex;gap:18px;align-items:center;margin-bottom:24px}.print-controls button{padding:10px 20px;background:#173f44;color:white;border:0;border-radius:8px;cursor:pointer}.print-controls span{font-size:13px}.print-document table{width:100%;border-collapse:collapse;table-layout:fixed}.print-document th,.print-document td{border:1px solid #dce4e7;padding:9px;vertical-align:top;text-align:right}.print-document th{background:#eef4f4;font-size:13px}.print-document th:first-child{width:8%}.print-shift{font-size:11px;padding:10px 0;border-bottom:1px solid #dce4e7;break-inside:avoid}.print-shift:last-child{border:0}.print-shift strong{display:block;margin-bottom:5px}.print-shift time{display:block;direction:ltr;text-align:right;font-weight:600}.print-shift ul{list-style:none;padding:0;margin:7px 0}.print-shift li{margin:3px 0}.print-document small{font-size:10px}.print-draft{color:#9b5d11;font-weight:700}@page{size:A4 landscape;margin:10mm}@media print{.print-document{padding:0}.print-controls{display:none!important}.print-document h1{font-size:20px}thead{display:table-header-group}tr{break-inside:auto}.print-document th,.print-document td{padding:6px}body{background:white!important}}
  `}</style>
      <PrintControls auto={query.auto === "1"} />
      <h1>{teamScope ? "משמרת · סידור שבועי" : `המשמרות שלי · ${user.name}`}</h1>
      <p>
        {week} — {addDays(week, 6)} ·{" "}
        <span className={version === "draft" ? "print-draft" : ""}>
          {version === "draft"
            ? "טיוטת מנהל — אינה הסידור המחייב לצוות"
            : "סידור שפורסם לצוות"}
        </span>
        {data.publishedAt && (
          <>
            {" "}
            · פרסום אחרון:{" "}
            {new Date(data.publishedAt).toLocaleString("he-IL", {
              timeZone: "Asia/Jerusalem",
            })}
          </>
        )}{" "}
        · שעון ישראל
      </p>
      {!admin && shifts.length === 0 ? (
        <p>{data.publishedAt ? (teamScope ? "אין משמרות בשבוע הזה." : "אין לך משמרות בשבוע הזה.") : "המשמרות יופיעו לאחר פרסום הלוח."}</p>
      ) : <table>
        <thead>
          <tr>
            <th>צוות</th>
            {weekDates(week).map((d, i) => (
              <th key={d}>
                {["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][i]}
                <br />
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g}>
              <th>{GROUP_LABELS[g]}</th>
              {weekDates(week).map((d) => (
                <td key={d}>
                  {shifts
                    .filter((s) => s.group === g && localDate(s.start) === d)
                    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
                    .map((s) => (
                      <div className="print-shift" key={s.id}>
                        <strong>{s.title}</strong>
                        <time>
                          {localTime(s.start)}–{localTime(s.end)}
                          {localDate(s.end) !== d
                            ? ` (${localDate(s.end)})`
                            : ""}
                        </time>
                        {teamScope && <ul>
                          {s.assignments.map((a, i) => (
                            <li key={i}>
                              {names.get(a.employeeId) ?? "עובד"}
                              {(a.start !== s.start || a.end !== s.end) && (
                                <>
                                  <br />
                                  <small dir="ltr">
                                    {localTime(a.start)}–{localTime(a.end)}
                                  </small>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>}
                        {admin && s.assignments.length === 0 && <small>לא משובץ</small>}
                        {admin && <small>דרושים {s.required} במקביל</small>}
                      </div>
                    ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>}
    </main>
  );
}
