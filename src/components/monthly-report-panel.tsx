"use client";

import { useEffect, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, RefreshCw, Users } from "lucide-react";
import type { MonthlyReport, MonthlyEmployeeReport } from "@/lib/monthly-report";
import type { SessionUser } from "@/lib/types";
import { GROUP_LABELS } from "@/lib/types";
import { localDate, localTime, today } from "@/lib/time";
import { api } from "@/lib/utils";

const number = (value: number) => new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 }).format(value);
const monthLabel = (month: string) => new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date(`${month}-15T12:00:00Z`));
const dateLabel = (date: string) => new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "short", timeZone: "Asia/Jerusalem" }).format(new Date(`${date}T12:00:00Z`));
const moveMonth = (month: string, delta: number) => Temporal.PlainYearMonth.from(month).add({ months: delta }).toString();
const deltaLabel = (current: number, previous: number) => {
  const difference = current - previous;
  return Math.abs(difference) < 0.05 ? "ללא שינוי" : `${difference > 0 ? "+" : "−"}${number(Math.abs(difference))} ש׳`;
};

export function MonthlyReportPanel({ user }: { user: SessionUser }) {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [result, setResult] = useState<MonthlyReport | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState("ALL");
  const [compare, setCompare] = useState("");
  const [sort, setSort] = useState("hours");
  const [search, setSearch] = useState("");
  const admin = user.role === "ADMIN";
  useEffect(() => {
    let cancelled = false;
    api<MonthlyReport>(`/api/reports/monthly?month=${month}`)
      .then((data) => { if (!cancelled) { setResult(data); setError(""); } })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [month, refresh]);
  const loading = result?.month !== month;
  const rows = !loading && result ? result.employees : [];
  const person = admin ? rows.find((row) => row.id === selected) : rows[0];
  const comparison = rows.find((row) => row.id === compare && row.id !== person?.id);
  const visibleRows = rows.filter((row) => row.name.includes(search.trim())).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "he") : sort === "shifts" ? b.totals.shifts - a.totals.shifts || a.name.localeCompare(b.name, "he") : b.totals.hours - a.totals.hours || a.name.localeCompare(b.name, "he"));
  function changeMonth(next: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next) || next < "1900-01" || next > "2100-12") return;
    setMonth(next); setError("");
  }
  return <section className="monthly-report" aria-label="דוח חודשי">
    <div className="page-heading">
      <div><div className="eyebrow">{admin ? "תמונת החודש של הצוות" : "החודש שלכם, מסודר"}</div><h1>{admin ? "סיכום חודשי" : "החודש שלי"}<span className="heading-dot">.</span></h1><p>{admin ? "משווים עומסים, בוחרים עובד ונכנסים לפרטים." : "השעות, המשמרות והימים שלכם במקום אחד."}</p></div>
      <button className="button secondary" onClick={() => { setResult(null); setError(""); setRefresh((value) => value + 1); }} aria-label="רענון הסיכום החודשי"><RefreshCw size={16} />רענון</button>
    </div>
    <div className="report-toolbar">
      <div className="report-month-nav">
        <button className="icon-button" aria-label="החודש הקודם" disabled={month === "1900-01"} onClick={() => changeMonth(moveMonth(month, -1))}><ChevronRight size={20} /></button>
        <label><span className="sr-only">בחירת חודש</span><input type="month" aria-label="בחירת חודש" min="1900-01" max="2100-12" value={month} onChange={(event) => changeMonth(event.target.value)} /></label>
        <button className="icon-button" aria-label="החודש הבא" disabled={month === "2100-12"} onClick={() => changeMonth(moveMonth(month, 1))}><ChevronLeft size={20} /></button>
      </div>
      <button className="text-button" onClick={() => changeMonth(today().slice(0, 7))}>החודש הנוכחי</button>
      {admin && <label className="report-person-picker"><span>תצוגה</span><select aria-label="בחירת עובד לסיכום" value={selected} onChange={(event) => { setSelected(event.target.value); setCompare(""); }}><option value="ALL">כל הצוות · השוואה</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.name}{row.active ? "" : " (לא פעיל)"}</option>)}</select></label>}
    </div>
    <p className="report-source">לפי שיבוצים שפורסמו בלבד · שעות לפי הלוח, ללא אישור נוכחות. שעות שחוצות חודש מחולקות בין החודשים.</p>
    {error ? <div className="notice error" role="alert">{error}<button className="text-button" onClick={() => { setError(""); setRefresh((value) => value + 1); }}>ניסיון נוסף</button></div> : loading ? <div className="report-empty" role="status">טוען את {monthLabel(month)}…</div> : <>
      {admin && !person ? <>
        <ReportStats hours={rows.reduce((sum, row) => sum + row.totals.hours, 0)} shifts={rows.reduce((sum, row) => sum + row.totals.shifts, 0)} days={rows.filter((row) => row.totals.shifts > 0).length} team />
        <section className="report-surface">
          <div className="report-section-heading"><div><h2>השוואת עובדים</h2><p>בחרו שם כדי לראות את הימים והמשמרות שלו.</p></div><div className="report-table-filters"><input aria-label="חיפוש עובד בדוח" placeholder="חיפוש עובד…" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="מיון ההשוואה" value={sort} onChange={(event) => setSort(event.target.value)}><option value="hours">לפי שעות</option><option value="shifts">לפי משמרות</option><option value="name">לפי שם</option></select></div></div>
          <ComparisonTable rows={visibleRows} onSelect={setSelected} />
          {visibleRows.length === 0 && <p className="report-empty">לא נמצאו עובדים לתצוגה.</p>}
        </section>
      </> : person ? <>
        {admin && <div className="report-person-heading"><h2>{person.name}{!person.active && <small> · לא פעיל</small>}</h2><label><span>השוואה לעובד נוסף</span><select aria-label="השוואה לעובד נוסף" value={compare} onChange={(event) => setCompare(event.target.value)}><option value="">ללא השוואה</option>{rows.filter((row) => row.id !== person.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>}
        <ReportStats hours={person.totals.hours} shifts={person.totals.shifts} days={person.totals.days} />
        <div className="report-progress"><span><b>{number(person.totals.elapsedHours)}</b> שעות בלוח שחלפו</span><span><b>{number(person.totals.remainingHours)}</b> שעות שנותרו בלוח</span><span>{person.totals.completedShifts} משמרות הסתיימו{person.totals.ongoingShifts ? ` · ${person.totals.ongoingShifts} כרגע` : ""} · {person.totals.upcomingShifts} עתידיות</span></div>
        <p className="report-previous">לעומת {monthLabel(result!.previousMonth)}: <b dir="auto">{deltaLabel(person.totals.hours, person.previous.hours)}</b> · {number(person.previous.hours)} שעות ו־{person.previous.shifts} משמרות בחודש הקודם. ההשוואה היא לסך השיבוצים בכל חודש.</p>
        {comparison && <section className="report-surface"><div className="report-section-heading"><h2>השוואה אישית</h2></div><ComparisonTable rows={[person, comparison]} /></section>}
        <EmployeeMonth key={`${person.id}-${month}`} person={person} month={month} />
      </> : <div className="report-empty">לא נמצא פרופיל עובד המקושר לחשבון. יש לפנות למנהל.</div>}
    </>}
  </section>;
}

function ReportStats({ hours, shifts, days, team = false }: { hours: number; shifts: number; days: number; team?: boolean }) {
  return <div className="report-stats" aria-label="סיכום החודש">
    {[{ label: "שעות בחודש", value: number(hours), Icon: Clock3 }, { label: team ? "שיבוצי עובדים" : "משמרות בחודש", value: shifts, Icon: CalendarDays }, { label: team ? "עובדים משובצים" : "ימי שיבוץ", value: days, Icon: team ? Users : CalendarDays }].map(({ label, value, Icon }) => <div className="report-stat" key={label}><Icon size={21} /><div><span>{label}</span><strong>{value}</strong></div></div>)}
  </div>;
}
function ComparisonTable({ rows, onSelect }: { rows: MonthlyEmployeeReport[]; onSelect?: (id: string) => void }) {
  return <div className="report-table-scroll"><table className="report-table"><caption className="sr-only">השוואת שעות, משמרות וימי שיבוץ בין עובדים</caption><thead><tr><th scope="col">עובד</th><th scope="col">שעות</th><th scope="col">משמרות</th><th scope="col">ימים</th><th scope="col">שינוי בשעות מהחודש הקודם</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><th scope="row">{onSelect ? <button className="text-button" onClick={() => onSelect(row.id)}>{row.name}<ChevronLeft size={14} /></button> : row.name}{!row.active && <small className="muted"> לא פעיל</small>}</th><td><b>{number(row.totals.hours)}</b></td><td>{row.totals.shifts}</td><td>{row.totals.days}</td><td dir="auto">{deltaLabel(row.totals.hours, row.previous.hours)}</td></tr>)}</tbody></table></div>;
}
function EmployeeMonth({ person, month }: { person: MonthlyEmployeeReport; month: string }) {
  const [date, setDate] = useState("");
  const [filter, setFilter] = useState("all");
  const first = Temporal.PlainDate.from(`${month}-01`);
  const blanks = first.dayOfWeek % 7;
  const days = Array.from({ length: first.daysInMonth }, (_, index) => first.add({ days: index }).toString());
  const byDay = new Map<string, typeof person.shifts>();
  for (const shift of person.shifts) for (const day of shift.days) byDay.set(day, [...(byDay.get(day) ?? []), shift]);
  const visible = person.shifts.filter((shift) => (!date || shift.days.includes(date)) && (filter === "all" || (filter === "completed" ? shift.status === "completed" : shift.status !== "completed")));
  return <div className="report-detail-grid">
    <section className="report-surface report-calendar"><div className="report-section-heading"><div><h2>{monthLabel(month)}</h2><p>בחרו יום לסינון הפירוט.</p></div>{date && <button className="text-button" onClick={() => setDate("")}>כל הימים</button>}</div>
      <div className="report-calendar-grid">{["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"].map((day) => <span className="report-weekday" key={day}>{day}</span>)}{Array.from({ length: blanks }, (_, index) => <span key={`blank-${index}`} />)}{days.map((day, index) => {
        const shifts = byDay.get(day) ?? [];
        const shiftCount = new Set(shifts.map((shift) => shift.shiftId)).size;
        return <button key={day} aria-label={`${dateLabel(day)}, ${shiftCount} משמרות`} aria-pressed={date === day} className={`report-day ${shifts.length ? "has-shifts" : ""} ${day === today() ? "is-today" : ""} ${date === day ? "selected" : ""}`} onClick={() => setDate(date === day ? "" : day)}><span>{index + 1}</span><span className="report-day-dots">{shifts.length > 0 && <i className={shifts.every((shift) => shift.status === "completed") ? "completed" : "upcoming"} />}</span></button>;
      })}</div><div className="report-legend"><span><i className="completed" />הסתיימו</span><span><i className="upcoming" />בתהליך או בהמשך</span></div>
    </section>
    <section className="report-surface report-shift-list"><div className="report-section-heading"><div><h2>{date ? dateLabel(date) : "פירוט המשמרות"}</h2><p>{visible.length} מקטעי שיבוץ בתצוגה</p></div><select aria-label="סינון משמרות בדוח" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">כל המשמרות</option><option value="completed">הסתיימו</option><option value="remaining">בתהליך ועתידיות</option></select></div>
      {visible.length === 0 ? <p className="report-empty">אין משמרות {date ? "ביום שנבחר" : "בתצוגה שנבחרה"}.{date && <button className="text-button" onClick={() => setDate("")}>הצגת כל החודש</button>}</p> : <ul>{visible.map((shift, index) => <li key={`${shift.id}-${shift.start}-${index}`}><div className="report-shift-date">{dateLabel(localDate(shift.start))}<span className={`report-shift-status ${shift.status}`}>{shift.status === "completed" ? "הסתיימה" : shift.status === "ongoing" ? "בתהליך" : "עתידית"}</span></div><h3>{shift.title}</h3><div className="report-shift-meta"><span>{GROUP_LABELS[shift.group]}</span><span dir="ltr">{localTime(shift.start)}–{localTime(shift.end)}</span>{localDate(shift.end) !== localDate(shift.start) && <span>עד {dateLabel(localDate(shift.end))}</span>}<b>{number(shift.hours)} שעות בחודש</b></div></li>)}</ul>}
    </section>
  </div>;
}
