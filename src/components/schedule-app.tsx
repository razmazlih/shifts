"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Users,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
  Plus,
  LogOut,
  Check,
  ArrowUpLeft,
  Clock3,
  Sparkles,
  Copy,
  Undo2,
  Trash2,
  Download,
  Printer,
  History,
  Layers,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  LoaderCircle,
  ShieldCheck,
  Menu,
} from "lucide-react";
import {
  GROUP_LABELS,
  type WeekData,
  type Shift,
  type Group,
  type SessionUser,
  type Template,
} from "@/lib/types";
import {
  addDays,
  weekStart,
  weekDates,
  today,
  localDate,
  localTime,
  localToISO,
} from "@/lib/time";
import { api } from "@/lib/utils";
import { Modal } from "./ui/dialog";
import { ShiftEditor } from "./shift-editor";
import { EmployeesPanel, SettingsPanel } from "./team-panels";
const MonthlyReportPanel = dynamic(() => import("./monthly-report-panel").then((module) => module.MonthlyReportPanel));
const fmtDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    ...options,
  }).format(new Date(`${date}T12:00:00Z`));
type Confirm = {
  title: string;
  description: string;
  action: string;
  run: () => Promise<void>;
};
export function ScheduleApp() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [week, setWeek] = useState(() => weekStart(today()));
  const [data, setData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [view, setView] = useState<"schedule" | "employees" | "settings" | "monthly">(
    "schedule",
  );
  const [mine, setMine] = useState(true);
  const [group, setGroup] = useState<"ALL" | Group>("ALL");
  const [editor, setEditor] = useState<{ shift: Shift; isNew: boolean } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [panel, setPanel] = useState<"history" | "templates" | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [history, setHistory] = useState<
    {
      id: string;
      action: string;
      createdAt: string;
      actorName: string;
      revision: number;
    }[]
  >([]);
  const [mobileNav, setMobileNav] = useState(false);
  const [refreshAt, setRefreshAt] = useState<Date | null>(null);
  const router = useRouter();
  const admin = user?.role === "ADMIN";
  const requestGeneration = useRef(0);
  const [employeeFilter, setEmployeeFilter] = useState("ALL");
  const reload = useCallback(
    async (quiet = false) => {
      const generation = ++requestGeneration.current;
      if (!quiet) setLoading(true);
      try {
        const value = await api<WeekData>(`/api/weeks?week=${week}`);
        if (generation !== requestGeneration.current) return;
        setData(value);
        setUser(value.user);
        setRefreshAt(new Date());
        setError("");
      } catch (e) {
        if (generation === requestGeneration.current)
          setError((e as Error).message);
      } finally {
        if (generation === requestGeneration.current) setLoading(false);
      }
    },
    [week],
  );
  useEffect(() => {
    const id = setTimeout(() => void reload(), 0);
    return () => {
      clearTimeout(id);
    };
  }, [reload]);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (admin || editor || busy || confirm) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void reload(true);
    };
    const id = setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [admin, editor, busy, confirm, reload]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const dates = weekDates(week);
  const shifts = useMemo(
    () =>
      [...(data?.shifts || [])]
        .flatMap((shift) => admin || !mine ? [shift] : shift.assignments
          .filter((a) => a.employeeId === user?.employeeId)
          .map((a, index) => ({ ...shift, id: `${shift.id}-${index}`, start: a.start, end: a.end, assignments: [a], note: undefined })))
        .sort((a, b) => a.start.localeCompare(b.start))
        .filter(
          (s) =>
            (group === "ALL" || s.group === group) &&
            (employeeFilter === "ALL" ||
              s.assignments.some((a) => a.employeeId === employeeFilter)) &&
            (admin || !mine ||
              s.assignments.some((a) => a.employeeId === user?.employeeId)),
        ),
    [data, group, admin, mine, user, employeeFilter],
  );
  const totalHours = (data?.shifts || []).reduce(
    (sum, s) =>
      sum +
      s.assignments.reduce(
        (n, a) =>
          n +
          (new Date(a.end).getTime() - new Date(a.start).getTime()) / 3600000,
        0,
      ),
    0,
  );
  const myShifts = (data?.shifts || []).filter((s) =>
    s.assignments.some((a) => a.employeeId === user?.employeeId),
  );
  const myHours = myShifts.reduce(
    (sum, s) =>
      sum +
      s.assignments
        .filter((a) => a.employeeId === user?.employeeId)
        .reduce(
          (n, a) =>
            n +
            (new Date(a.end).getTime() - new Date(a.start).getTime()) / 3600000,
          0,
        ),
    0,
  );
  const unfilled = new Set(
    data?.issues
      .filter(
        (i) =>
          i.code.includes("COVER") ||
          i.code.includes("UNFILLED") ||
          i.code.includes("UNDERSTAFF"),
      )
      .map((i) => i.shiftId),
  ).size;
  const shortage = (data?.shifts || []).filter(hasCoverageGap).length;
  const errors = data?.issues.filter((i) => i.severity === "error") || [];
  async function mutate(path: string, body: unknown, success: string) {
    setBusy(true);
    setError("");
    try {
      const value = await api<WeekData>(path, "POST", body);
      setData(value);
      setToast(success);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function saveShifts(next: Shift[]) {
    if (!data) return;
    setBusy(true);
    try {
      const value = await api<WeekData>("/api/weeks", "PUT", {
        weekStart: week,
        revision: data.revision,
        shifts: next,
      });
      setData(value);
      setToast("השינויים נשמרו בטיוטה");
    } finally {
      setBusy(false);
    }
  }
  function changeWeek(next: string) {
    if (next === week) return;
    requestGeneration.current++;
    setLoading(true);
    setWeek(next);
  }
  function newShift(date = dates[0], team: Group = "MANAGERS") {
    if (loading || busy) return;
    setEditor({
      isNew: true,
      shift: {
        id: crypto.randomUUID(),
        title: "משמרת בוקר",
        group: team,
        start: localToISO(date, "07:00"),
        end: localToISO(date, "15:00"),
        required: 1,
        assignments: [],
      },
    });
  }
  function confirmMutation(
    title: string,
    description: string,
    action: string,
    path: string,
    extra: Record<string, unknown> = {},
  ) {
    if (!data) return;
    setConfirm({
      title,
      description,
      action,
      run: () =>
        mutate(
          path,
          { weekStart: week, revision: data.revision, ...extra },
          "הלוח עודכן בהצלחה",
        ),
    });
  }
  async function openPanel(kind: "history" | "templates") {
    setPanel(kind);
    setError("");
    try {
      if (kind === "history")
        setHistory(
          (await api<{ history: typeof history }>(`/api/history?week=${week}`))
            .history,
        );
      else
        setTemplates(
          (await api<{ templates: Template[] }>("/api/templates")).templates,
        );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const navigate = (next: typeof view) => {
    setView(next);
    setMobileNav(false);
  };
  return (
    <div className={`app-layout ${admin ? "role-admin" : "role-employee"}`}>
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <Link className="brand" href="/">
          <span className="brand-mark">
            <CalendarDays size={25} />
          </span>
          <span>
            משמרת<span className="brand-caption">הצוות שלכם, מסודר.</span>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-dot" />
          מרחב הצוות<span className="tag">{admin ? "ניהול" : "עובד"}</span>
        </div>
        <div className="nav-caption">סביבת העבודה</div>
        <nav>
          <button
            className={view === "schedule" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("schedule")}
          >
            <CalendarDays size={20} />
            {admin || !mine ? "לוח משמרות" : "המשמרות שלי"}
            <ChevronLeft size={15} />
          </button>
          <button className={view === "monthly" ? "nav-item active" : "nav-item"} onClick={() => navigate("monthly")}><Clock3 size={20} />{admin ? "סיכום חודשי" : "החודש שלי"}<ChevronLeft size={15} /></button>
          {admin && (
            <>
              <button
                className={
                  view === "employees" ? "nav-item active" : "nav-item"
                }
                onClick={() => navigate("employees")}
              >
                <Users size={20} />
                אנשי הצוות
                <span className="nav-count">
                  {data?.employees.filter((e) => e.active).length ?? "—"}
                </span>
              </button>
              <button
                className={view === "settings" ? "nav-item active" : "nav-item"}
                onClick={() => navigate("settings")}
              >
                <SlidersHorizontal size={20} />
                הגדרות שיבוץ
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon">
              <ShieldCheck size={18} />
            </span>
            <strong>{admin ? "התכנון בידיים שלכם" : "תמיד מעודכנים"}</strong>
            <p>
              {admin
                ? "שינויים נשמרים בטיוטה. כשתהיו מוכנים, פרסמו את הלוח לצוות."
                : "כאן מופיעות רק משמרות שפורסמו. הלוח מתעדכן אוטומטית."}
            </p>
          </div>
          <div className="profile">
            <span className="avatar">{user?.name.charAt(0) || "מ"}</span>
            <div>
              <strong>{user?.name || "טוען…"}</strong>
              <small>{admin ? "מנהל מערכת" : "חבר צוות"}</small>
            </div>
            <button
              className="icon-button"
              aria-label="יציאה מהמערכת"
              onClick={async () => {
                await api("/api/auth/logout", "POST");
                router.replace("/login");
                router.refresh();
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="sidebar-backdrop"
          aria-label="סגירת תפריט"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="פתיחת תפריט"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <span>מרחב הצוות</span>
            <ChevronLeft size={14} />
            <strong>
              {view === "schedule"
                ? admin ? "לוח משמרות" : "המשמרות שלי"
                : view === "monthly"
                  ? admin ? "סיכום חודשי" : "החודש שלי"
                : view === "employees"
                  ? "אנשי הצוות"
                  : "הגדרות שיבוץ"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="today-label">
              {fmtDate(today(), {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </span>
            <span className="avatar small">{user?.name.charAt(0) || "מ"}</span>
          </div>
        </header>
        <div className="page-content">
          {error && (
            <div className="notice error global-error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button className="text-button" onClick={() => reload()}>
                רענון
              </button>
              <button
                className="icon-button"
                aria-label="סגירת הודעה"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "monthly" && user ? (
            <MonthlyReportPanel user={user} />
          ) : view === "employees" && admin ? (
            <EmployeesPanel
              defaultMaxHours={data?.rules.defaultMaxWeeklyHours}
              onUpdated={() => reload(true)}
            />
          ) : view === "settings" && admin && data ? (
            <SettingsPanel
              initialRules={data.rules}
              onUpdated={() => reload(true)}
            />
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">
                    {admin ? "כל הצוות. תמונה אחת." : "השבוע שלכם, במבט אחד."}
                  </div>
                  <h1>
                    {admin || !mine ? "לוח משמרות" : "המשמרות שלי"}<span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {admin
                      ? "מתכננים שבוע טוב, ביחד."
                      : "כל מה שצריך לדעת לקראת המשמרת הבאה."}
                  </p>
                </div>
                <div className="heading-actions">
                  {admin ? (
                    <>
                      <span
                        className={`status-pill ${data?.hasDraft ? "draft" : "published"}`}
                      >
                        <span />
                        {data?.hasDraft
                          ? "טיוטה · טרם פורסמה"
                          : data?.publishedAt
                            ? "פורסם לצוות"
                            : "לוח חדש"}
                      </span>
                      <button
                        className="button primary"
                        disabled={busy || loading || !data?.hasDraft}
                        onClick={() =>
                          confirmMutation(
                            "לפרסם את השבוע לצוות?",
                            `לאחר הפרסום, העובדים יראו את הגרסה הנוכחית של הלוח.${errors.length ? ` קיימות ${errors.length} התנגשויות שחייבים לפתור לפני הפרסום.` : ""}${shortage || unfilled ? ` לתשומת לבכם: ${Math.max(shortage, unfilled)} משמרות עדיין אינן מכוסות במלואן.` : ""}`,
                            "פרסום לצוות",
                            "/api/weeks/publish",
                          )
                        }
                      >
                        <ArrowUpLeft size={17} />
                        פרסום לצוות
                      </button>
                    </>
                  ) : (
                    <span className="status-pill published">
                      <span />
                      {loading ? "טוען…" : data?.publishedAt ? "לוח מעודכן" : "ממתין לפרסום"}
                    </span>
                  )}
                </div>
              </section>
              <section className="stats-grid" aria-label="סיכום שבועי">
                <div className="stat-card">
                  <span className="stat-icon teal">
                    <CalendarDays size={20} />
                  </span>
                  <div>
                    <span>{admin ? "משמרות השבוע" : "המשמרות שלי"}</span>
                    <strong>
                      {loading
                        ? "—"
                        : admin
                          ? (data?.shifts.length ?? 0)
                          : myShifts.length}
                      <small>משמרות</small>
                    </strong>
                  </div>
                  <span className="stat-caption">
                    {admin ? "תכנון שבועי" : "לפי הלוח שפורסם"}
                  </span>
                </div>
                {admin && (
                <div className="stat-card">
                  <span className="stat-icon purple">
                    <Users size={20} />
                  </span>
                  <div>
                    <span>{admin ? "עובדים משובצים" : "חברי הצוות"}</span>
                    <strong>
                      {loading
                        ? "—"
                        : admin
                          ? new Set(
                              data?.shifts.flatMap((s) =>
                                s.assignments.map((a) => a.employeeId),
                              ),
                            ).size
                          : (data?.employees.filter((e) => e.active).length ??
                            0)}
                      <small>אנשים</small>
                    </strong>
                  </div>
                  <span className="stat-caption">
                    {admin
                      ? `מתוך ${data?.employees.filter((e) => e.active).length ?? 0} בצוות`
                      : "עובדים יחד"}
                  </span>
                </div>
                )}
                <div className="stat-card">
                  <span className="stat-icon blue">
                    <Clock3 size={20} />
                  </span>
                  <div>
                    <span>{admin ? "שעות משובצות" : "השעות שלי"}</span>
                    <strong>
                      {loading
                        ? "—"
                        : Math.round((admin ? totalHours : myHours) * 10) / 10}
                      <small>שעות</small>
                    </strong>
                  </div>
                  <span className="stat-caption">השבוע הנבחר</span>
                </div>
                {admin && (
                <div className="stat-card">
                  <span
                    className={`stat-icon ${errors.length || shortage ? "amber" : "teal"}`}
                  >
                    {errors.length || shortage ? (
                      <AlertCircle size={20} />
                    ) : (
                      <CheckCircle2 size={20} />
                    )}
                  </span>
                  <div>
                    <span>{admin ? "משמרות להשלמה" : "מצב הפרסום"}</span>
                    <strong>
                      {loading
                        ? "—"
                        : admin
                          ? Math.max(shortage, unfilled)
                          : data?.publishedAt
                            ? "פורסם"
                            : "ממתין"}
                      {admin && <small>משמרות</small>}
                    </strong>
                  </div>
                  <span className="stat-caption">
                    {admin
                      ? errors.length
                        ? `${errors.length} התנגשויות לבדיקה`
                        : shortage
                          ? "עוד רגע, והצוות מוכן"
                          : "אין התנגשויות"
                      : data?.publishedAt
                        ? "זמין לצוות"
                        : "הלוח יופיע לאחר פרסום"}
                  </span>
                </div>
                )}
              </section>
              {admin && data?.autoSummary && (
                <div className="auto-result notice" role="status">
                  <Sparkles size={18} />
                  <div>
                    <strong>השיבוץ החכם הסתיים · נשמר בטיוטה</strong>
                    <p>
                      תוקנו {data.autoSummary.resolvedErrors} התראות שגיאה · עודכנו {data.autoSummary.changedShiftIds.length} משמרות.
                    </p>
                    <p>
                      {data.autoSummary.remainingErrors === 0 && data.autoSummary.unfilledShifts === 0
                        ? "הסידור תקין וכל המשמרות מכוסות. אפשר לבדוק ולפרסם לצוות."
                        : `נותרו ${data.autoSummary.remainingErrors} התראות שגיאה ו־${data.autoSummary.unfilledShifts} משמרות עם חוסר עובדים. יש לבדוק את האזהרות בלוח.`}
                    </p>
                    {data.autoSummary.changedShiftIds.length > 0 && (
                      <details>
                        <summary>אילו משמרות עודכנו?</summary>
                        <ul>{data.shifts.filter((shift) => data.autoSummary!.changedShiftIds.includes(shift.id)).map((shift) => (
                          <li key={shift.id}>{fmtDate(localDate(shift.start), { weekday: "long", day: "numeric", month: "numeric" })} · {shift.title} · <bdi>{localTime(shift.start)}–{localTime(shift.end)}</bdi></li>
                        ))}</ul>
                      </details>
                    )}
                  </div>
                </div>
              )}
              <section className="schedule-panel">
                <div className="calendar-toolbar">
                  <div className="week-heading">
                    <div className="calendar-icon">
                      <CalendarDays size={21} />
                    </div>
                    <div>
                      <h2>
                        {fmtDate(week, { day: "numeric" })}–
                        {fmtDate(dates[6], {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </h2>
                      <span>שבוע עבודה · ראשון עד שבת</span>
                    </div>
                    <div className="week-navigation">
                      <button
                        className="icon-button"
                        aria-label="שבוע קודם"
                        disabled={busy}
                        onClick={() => changeWeek(addDays(week, -7))}
                      >
                        <ChevronRight size={19} />
                      </button>
                      <button
                        className="button today-button"
                        disabled={busy}
                        onClick={() => changeWeek(weekStart(today()))}
                      >
                        היום
                      </button>
                      <button
                        className="icon-button"
                        aria-label="שבוע הבא"
                        disabled={busy}
                        onClick={() => changeWeek(addDays(week, 7))}
                      >
                        <ChevronLeft size={19} />
                      </button>
                    </div>
                    <input
                      className="week-picker"
                      aria-label="בחירת שבוע"
                      type="date"
                      value={week}
                      onChange={(e) => {
                        if (e.target.value)
                          changeWeek(weekStart(e.target.value));
                      }}
                    />
                  </div>
                  {admin && (
                    <button
                      className="button primary add-shift"
                      disabled={busy || loading}
                      onClick={() => newShift()}
                    >
                      <Plus size={18} />
                      משמרת חדשה
                    </button>
                  )}
                  {!admin && (
                    <div className="segmented" aria-label="תצוגת הסידור">
                      <button className={mine ? "selected" : ""} aria-pressed={mine} onClick={() => { setMine(true); setEditor(null); }}>
                        המשמרות שלי
                      </button>
                      <button className={!mine ? "selected" : ""} aria-pressed={!mine} onClick={() => { setMine(false); setEditor(null); }}>
                        כל הסידור השבועי
                      </button>
                    </div>
                  )}
                </div>
                {admin && <div className="calendar-subbar">
                  <div className="filters">
                    <button
                      className={group === "ALL" ? "filter selected" : "filter"}
                      onClick={() => setGroup("ALL")}
                    >
                      כל הצוותים
                    </button>
                    {Object.entries(GROUP_LABELS).map(([key, label]) => (
                      <button
                        key={key}
                        className={group === key ? "filter selected" : "filter"}
                        onClick={() => setGroup(key as Group)}
                      >
                        <span
                          className={`legend-dot ${key === "PATROL" ? "purple" : ""}`}
                        />
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="schedule-employee-filter">
                    <span>הצגה לפי עובד</span>
                      <select
                        className="employee-filter"
                        aria-label="סינון לפי עובד"
                        value={employeeFilter}
                        onChange={(e) => setEmployeeFilter(e.target.value)}
                      >
                        <option value="ALL">כל העובדים</option>
                        {data?.employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                  </label>
                </div>
                }
                {admin && (
                  <section className="schedule-actions" aria-label="פעולות לניהול השבוע">
                    <div className="schedule-actions-heading">
                      <strong>כלים לניהול השבוע</strong>
                      <span>השינויים נשמרים בטיוטה · הצוות יראה אותם רק לאחר פרסום</span>
                    </div>
                    <div className="schedule-action-grid">
                    <div className="schedule-action-group" role="group" aria-label="בניית הסידור">
                      <button
                        className="schedule-action smart-action"
                        aria-label="שיבוץ חכם"
                        disabled={busy || loading}
                        onClick={() =>
                          confirmMutation(
                            "שיבוץ חכם ותיקון בעיות",
                            "המערכת תנסה לתקן חפיפות, חריגות וזמינות ולמלא מקומות חסרים. שיבוצים בעייתיים עשויים להשתנות או להתפנות אם אין עובד מתאים. שיבוצים תקינים יישמרו ככל האפשר. התוצאה תישמר בטיוטה בלבד, ואפשר לבטל דרך ביטול השינוי האחרון.",
                            "תיקון ושיבוץ",
                            "/api/weeks/auto",
                          )
                        }
                      >
                        <Sparkles size={16} />
                        <span><strong>שיבוץ חכם</strong><small>מילוי חוסרים ותיקון בעיות</small></span>
                      </button>
                      <button
                        className="schedule-action"
                        title="העתקת השבוע הקודם"
                        aria-label="העתקת השבוע הקודם"
                        disabled={busy || loading}
                        onClick={() =>
                          confirmMutation(
                            "להעתיק את השבוע הקודם?",
                            "פעולה זו תחליף את טיוטת השבוע הנוכחי במשמרות ובשיבוצים של השבוע הקודם. לאחר ההעתקה יש לבדוק זמינות והתנגשויות.",
                            "העתקת שבוע",
                            "/api/weeks/copy",
                            { sourceWeek: addDays(week, -7) },
                          )
                        }
                      >
                        <Copy size={18} aria-hidden="true" />
                        <span><strong>העתקת השבוע הקודם</strong><small>החלפת הטיוטה בסידור הקודם</small></span>
                      </button>
                      <button
                        className="schedule-action"
                        title="תבניות שבוע"
                        aria-label="תבניות שבוע"
                        disabled={busy || loading}
                        onClick={() => openPanel("templates")}
                      >
                        <Layers size={18} aria-hidden="true" />
                        <span><strong>תבניות שבוע</strong><small>שמירה וטעינה של סידור קבוע</small></span>
                      </button>
                    </div>
                    <div className="schedule-action-group history-actions" role="group" aria-label="שחזור ואיפוס">
                      <button
                        className="schedule-action"
                        title="ביטול השינוי האחרון"
                        aria-label="ביטול השינוי האחרון"
                        disabled={busy || loading || !data?.revision}
                        onClick={() =>
                          confirmMutation(
                            "לבטל את השינוי האחרון?",
                            "טיוטת השבוע תשוחזר לגרסה הקודמת. הגרסה שכבר פורסמה לצוות תישאר עד לפרסום הבא.",
                            "ביטול שינוי",
                            "/api/weeks/undo",
                          )
                        }
                      >
                        <Undo2 size={18} aria-hidden="true" />
                        <span><strong>ביטול השינוי האחרון</strong><small>{data?.revision ? "חזרה לגרסה הקודמת של הטיוטה" : "אין שינוי קודם לשחזור"}</small></span>
                      </button>
                      <button
                        className="schedule-action reset-action"
                        title="איפוס כל השבוע"
                        aria-label="איפוס כל השבוע"
                        disabled={busy || loading || !data?.shifts.length}
                        onClick={() =>
                          confirmMutation(
                            "לאפס את כל השבוע?",
                            `כל ${data?.shifts.length ?? 0} המשמרות והשיבוצים בשבוע ${fmtDate(week, { day: "numeric", month: "numeric" })}–${fmtDate(dates[6], { day: "numeric", month: "numeric", year: "numeric" })} יימחקו מהטיוטה, בכל הקבוצות וגם אם מופעל סינון. ניתן לשחזר באמצעות ביטול השינוי האחרון. הסידור שפורסם לצוות יישאר עד לפרסום הבא.`,
                            "איפוס כל השבוע",
                            "/api/weeks/reset",
                          )
                        }
                      >
                        <Trash2 size={18} aria-hidden="true" />
                        <span><strong>איפוס כל השבוע</strong><small>מחיקת כל המשמרות מהטיוטה</small></span>
                      </button>
                    </div>
                    </div>
                  </section>
                )}
                {loading ? (
                  <div className="calendar-loading">
                    <LoaderCircle className="spin" />
                    <p>מסדרים את השבוע…</p>
                  </div>
                ) : (
                  <div className="week-grid">
                    {dates.map((date, index) => (
                      <div
                        className={`day-column ${date === today() ? "is-today" : ""} ${index === 6 ? "weekend" : ""}`}
                        key={date}
                      >
                        <div className="day-heading">
                          <span>{fmtDate(date, { weekday: "long" })}</span>
                          <strong>{fmtDate(date, { day: "numeric" })}</strong>
                          {date === today() && <small>היום</small>}
                        </div>
                        <div className="day-content">
                          {!admin && !shifts.some((s) => localDate(s.start) === date) && (
                            <div className="empty-day"><span>{data?.publishedAt ? mine ? "אין לך משמרות" : "אין משמרות" : "ממתין לפרסום"}</span></div>
                          )}
                          {(["MANAGERS", "PATROL"] as Group[])
                            .filter((g) => admin
                              ? group === "ALL" || g === group
                              : shifts.some((s) => s.group === g && localDate(s.start) === date))
                            .map((team) => (
                              <section className="day-group" key={team}>
                                <div className="day-group-label">
                                  <span
                                    className={`legend-dot ${team === "PATROL" ? "purple" : ""}`}
                                  />
                                  {GROUP_LABELS[team]}
                                  {admin && (
                                    <button
                                      className="day-add"
                                      aria-label={`הוספת משמרת ${GROUP_LABELS[team]} ${date}`}
                                      onClick={() => newShift(date, team)}
                                    >
                                      <Plus size={13} />
                                    </button>
                                  )}
                                </div>
                                {shifts
                                  .filter(
                                    (s) =>
                                      localDate(s.start) === date &&
                                      s.group === team,
                                  )
                                  .map((shift) => (
                                    <ShiftCard
                                      key={shift.id}
                                      shift={shift}
                                      data={data!}
                                      admin={admin}
                                      mine={shift.assignments.some(
                                        (a) =>
                                          a.employeeId === user?.employeeId,
                                      )}
                                      onClick={() => {
                                        if (!busy && !loading)
                                          setEditor({ shift, isNew: false });
                                      }}
                                    />
                                  ))}
                                {shifts.filter(
                                  (s) =>
                                    localDate(s.start) === date &&
                                    s.group === team,
                                ).length === 0 && (
                                  <div className="empty-day">
                                    {admin ? (
                                      <button
                                        onClick={() => newShift(date, team)}
                                      >
                                        <Plus size={14} />
                                        הוספה
                                      </button>
                                    ) : (
                                      <span>אין משמרות</span>
                                    )}
                                  </div>
                                )}
                              </section>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <footer className="calendar-footer">
                  {admin && <div>
                    <span className="legend-dot" />
                    אחמ״שים
                    <span className="legend-dot purple" />
                    סיורים
                    {admin && (
                      <>
                        <span className="legend-dot amber" />
                        אזהרה / נדרש שיבוץ
                        <span className="legend-dot red" />
                        בעיה בשיבוץ
                      </>
                    )}
                  </div>
                  }
                  <span className="sync-label">
                    <Check size={14} />
                    {busy
                      ? "שומר שינויים…"
                      : refreshAt
                        ? `עודכן ${refreshAt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`
                        : "מתחבר…"}
                  </span>
                </footer>
              </section>
              <div className="below-calendar">
                <p>
                  <ShieldCheck size={15} />
                  {data?.publishedAt
                    ? `פורסם לצוות ב־${new Date(data.publishedAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}${admin ? " · השינויים הבאים נשמרים בטיוטה." : " · מתעדכן אוטומטית."}`
                    : admin
                      ? "רק לוח שפורסם גלוי לעובדים. כל שינוי נשמר ומתועד."
                      : "הלוח יופיע כאן אחרי שהמנהל יפרסם אותו."}
                </p>
                <div className="button-row">
                  {admin && (
                    <>
                      <button
                        className="text-button"
                        onClick={() => openPanel("history")}
                      >
                        <History size={15} />
                        היסטוריית שינויים
                      </button>
                      <a
                        className="text-button"
                        href={`/api/export?week=${week}&version=draft`}
                      >
                        <Download size={15} />
                        ייצוא לאקסל
                      </a>
                    </>
                  )}
                  <a
                    className="text-button"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`/print?week=${week}&version=${admin ? "draft" : "published"}&scope=${!admin && !mine ? "team" : "mine"}&auto=1`}
                  >
                    <Printer size={15} />
                    הדפסה
                  </a>
                  <button
                    className="icon-button"
                    aria-label="רענון הלוח"
                    onClick={() => reload()}
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
              </div>

            </>
          )}
        </div>
        <footer className="page-footer">
          <strong>משמרת</strong>
          <span>תכנון פשוט. צוות מתואם.</span>
          <small>שעון ישראל · Asia/Jerusalem</small>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {editor &&
        data &&
        (admin ? (
          <ShiftEditor
            shift={editor.shift}
            data={data}
            isNew={editor.isNew}
            busy={busy}
            onClose={() => setEditor(null)}
            onSave={async (shift, duplicate) => {
              const final = duplicate
                ? {
                    ...shift,
                    id: crypto.randomUUID(),
                    title: `${shift.title} — העתק`,
                  }
                : shift;
              await saveShifts([
                ...data.shifts.filter((s) => duplicate || s.id !== shift.id),
                final,
              ]);
              setEditor(null);
            }}
            onDelete={async (id) => {
              await saveShifts(data.shifts.filter((s) => s.id !== id));
              setEditor(null);
            }}
          />
        ) : (
          <Modal
            open
            onClose={() => setEditor(null)}
            title={editor.shift.title}
            description={`${GROUP_LABELS[editor.shift.group]} · ${fmtDate(localDate(editor.shift.start), { weekday: "long", day: "numeric", month: "long" })}`}
          >
            <div className="editor-body">
              <p className="shift-detail-time" dir="ltr">
                {localTime(editor.shift.start)} — {localTime(editor.shift.end)}
              </p>
              {localDate(editor.shift.end) !==
                localDate(editor.shift.start) && (
                <p>
                  סיום:{" "}
                  {fmtDate(localDate(editor.shift.end), {
                    day: "numeric",
                    month: "long",
                  })}
                </p>
              )}
              <h3>{mine ? "השיבוץ שלי" : "הצוות במשמרת"}</h3>
              {editor.shift.assignments.map((a, i) => (
                <div key={i} className="assignee-row">
                  <span className="avatar small">
                    {data.employees
                      .find((e) => e.id === a.employeeId)
                      ?.name.charAt(0)}
                  </span>
                  <strong>
                    {data.employees.find((e) => e.id === a.employeeId)?.name}
                  </strong>
                  <span dir="ltr">
                    {localTime(a.start)}–{localTime(a.end)}
                  </span>
                  {a.employeeId === user?.employeeId && (
                    <span className="tag green">המשמרת שלי</span>
                  )}
                </div>
              ))}
              {editor.shift.note && (
                <div className="notice">{editor.shift.note}</div>
              )}
            </div>
          </Modal>
        ))}
      {confirm && (
        <Modal
          open
          onClose={() => !busy && setConfirm(null)}
          title={confirm.title}
          description={confirm.description}
        >
          <div className="dialog-footer">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              ביטול
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                try {
                  await confirm.run();
                  setConfirm(null);
                } catch {
                  setConfirm(null);
                }
              }}
            >
              {busy ? "מבצע…" : confirm.action}
            </button>
          </div>
        </Modal>
      )}
      {panel && (
        <Modal
          open
          onClose={() => setPanel(null)}
          title={panel === "history" ? "היסטוריית שינויים" : "תבניות שבוע"}
          description={
            panel === "history"
              ? "כל שינוי מתועד, כדי שתמיד תהיה תמונה מלאה."
              : "שמרו שבוע מוצלח והשתמשו בו כנקודת פתיחה לשבוע הבא."
          }
        >
          <div className="editor-body">
            {panel === "history" ? (
              history.length ? (
                history.map((h) => (
                  <div className="history-row" key={h.id}>
                    <span className="stat-icon teal">
                      <History size={17} />
                    </span>
                    <div>
                      <strong>
                        {(
                          {
                            CREATE: "יצירת שבוע",
                            UPDATE: "עדכון משמרות",
                            PUBLISH: "פרסום לצוות",
                            AUTO: "שיבוץ אוטומטי",
                            COPY: "העתקת שבוע",
                            RESET: "איפוס כל השבוע",
                            UNDO: "ביטול שינוי",
                            TEMPLATE: "החלת תבנית",
                          } as Record<string, string>
                        )[h.action.toUpperCase()] || h.action}
                      </strong>
                      <small>
                        {h.actorName} · גרסה {h.revision}
                      </small>
                    </div>
                    <time>{new Date(h.createdAt).toLocaleString("he-IL")}</time>
                  </div>
                ))
              ) : (
                <p className="empty-label">עדיין אין שינויים מתועדים השבוע.</p>
              )
            ) : (
              <>
                <div className="template-save">
                  <label>
                    שמירת השבוע הנוכחי כתבנית
                    <input
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="למשל, שבוע פעילות רגיל"
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={!templateName.trim() || busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api("/api/templates", "POST", {
                          name: templateName,
                          weekStart: week,
                        });
                        setTemplateName("");
                        setTemplates(
                          (
                            await api<{ templates: Template[] }>(
                              "/api/templates",
                            )
                          ).templates,
                        );
                        setToast("התבנית נשמרה");
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    שמירת תבנית
                  </button>
                </div>
                {templates.map((t) => (
                  <div className="template-row" key={t.id}>
                    <Layers size={20} />
                    <div>
                      <strong>{t.name}</strong>
                      <small>{t.shifts.length} משמרות</small>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setPanel(null);
                        confirmMutation(
                          "להחיל את התבנית?",
                          `התבנית ״${t.name}״ תחליף את הטיוטה הנוכחית. בדקו את השיבוצים לפני הפרסום.`,
                          "החלת תבנית",
                          "/api/templates/apply",
                          { templateId: t.id },
                        );
                      }}
                    >
                      החלה
                    </button>
                  </div>
                ))}
                {templates.length === 0 && (
                  <p className="empty-label">התבנית הראשונה שלכם מתחילה כאן.</p>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function ShiftCard({
  shift,
  data,
  admin,
  mine,
  onClick,
}: {
  shift: Shift;
  data: WeekData;
  admin: boolean;
  mine: boolean;
  onClick: () => void;
}) {
  const short = admin && hasCoverageGap(shift);
  const issues = data.issues.filter(
    (i) => admin && i.shiftId === shift.id,
  );
  const severity = issues.some((i) => i.severity === "error")
    ? "error" : issues.length > 0 ? "warning" : "";
  return (
    <button
      className={`shift-card ${shift.group === "PATROL" ? "patrol" : ""} ${short ? "short-staffed" : ""} ${severity ? `has-${severity}` : ""} ${mine && !admin ? "my-shift" : ""}`}
      onClick={onClick}
    >
      <div className="shift-card-top">
        <span className="shift-time" dir="ltr">
          {localTime(shift.start)}–{localTime(shift.end)}
        </span>
        {localDate(shift.start) !== localDate(shift.end) && (
          <small className="overnight">
            +
            {Math.round(
              (Date.parse(localDate(shift.end)) -
                Date.parse(localDate(shift.start))) /
                86400000,
            )}
          </small>
        )}
        {issues.length > 0 && <AlertCircle size={13} />}
      </div>
      <strong className="shift-title">{shift.title}</strong>
      <div className="shift-people">
        {shift.assignments.slice(0, 3).map((a, i) => (
          <span key={`${a.employeeId}-${i}`}>
            <span className="person-dot" />
            {data.employees.find((e) => e.id === a.employeeId)?.name || "עובד"}
            {!admin && a.employeeId === data.user.employeeId && (
              <small> (אני)</small>
            )}
          </span>
        ))}
        {shift.assignments.length > 3 && (
          <small>ועוד {shift.assignments.length - 3} עובדים</small>
        )}
      </div>
      {issues.length > 0 && (
        <span className="shift-issues">
          <span className="shift-issue-summary">
            <AlertCircle size={13} aria-hidden="true" />
            <span>
              {issues[0].employeeId && <b>{data.employees.find((e) => e.id === issues[0].employeeId)?.name || "עובד לא מזוהה"}: </b>}
              {issues[0].message}
            </span>
          </span>
          {issues.length > 1 && <small>ועוד {issues.length - 1} לבדיקה · לחצו לפרטים</small>}
        </span>
      )}
      {admin && issues.length === 0 && (short ? (
        <span className="shift-warning">
          <AlertCircle size={12} />
          {shift.assignments.length === 0
            ? "ממתין לשיבוץ"
            : "כיסוי חלקי — נדרש שיבוץ"}
        </span>
      ) : (
        <span className="shift-covered">
          <Check size={12} />
          כיסוי מלא · {shift.required} עמדות
        </span>
      ))}
      {admin && shift.note && <span className="shift-note">{shift.note}</span>}
    </button>
  );
}

function hasCoverageGap(shift: Shift) {
  const start = Date.parse(shift.start),
    end = Date.parse(shift.end);
  const spans = shift.assignments.map((a) => ({
    start: Date.parse(a.start),
    end: Date.parse(a.end),
  }));
  const points = [
    ...new Set([
      start,
      end,
      ...spans.flatMap((a) => [
        Math.max(start, Math.min(end, a.start)),
        Math.max(start, Math.min(end, a.end)),
      ]),
    ]),
  ].sort((a, b) => a - b);
  return points
    .slice(0, -1)
    .some(
      (p, i) =>
        spans.filter((a) => a.start <= p && a.end >= points[i + 1]).length <
        shift.required,
    );
}
