"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock3, RefreshCw } from "lucide-react";
import { localDate, localTime } from "@/lib/time";
import { personalShiftEndLabel, type PersonalSchedule, type PersonalShift } from "@/lib/personal-schedule";
import "./employee-home.css";

const dayLabel = (iso: string) => new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long", year: "numeric",
}).format(new Date(iso));
const roleLabel = (shift: PersonalShift) => shift.group === "MANAGERS" ? "אחמ״ש" : "סייר";

function ShiftDetails({ shift }: { shift: PersonalShift }) {
  const overnight = personalShiftEndLabel(shift);
  return <>
    <p className="personal-shift-date">{dayLabel(shift.start)}</p>
    <p className="personal-shift-time"><Clock3 size={19} aria-hidden="true" /><bdi dir="ltr">{localTime(shift.start)}–{localTime(shift.end)}</bdi></p>
    {overnight && <p className="personal-night">{overnight} · {dayLabel(shift.end)}</p>}
    <p className="personal-shift-role">{roleLabel(shift)} · {shift.title}</p>
  </>;
}

export function EmployeeHome({ onViewTeam, onViewMonth }: {
  onViewTeam?: () => void;
  onViewMonth?: () => void;
}) {
  const [data, setData] = useState<PersonalSchedule | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const router = useRouter();
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    try {
      const response = await fetch("/api/me/schedule", { cache: "no-store", signal: request.signal });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error("לא ניתן לטעון את המשמרות שלך כרגע. נסו שוב.");
      const value: PersonalSchedule = await response.json();
      if (!request.signal.aborted) { setData(value); setError(""); }
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof TypeError ? "אין חיבור לשרת. לא ניתן לוודא שהמשמרות מעודכנות." : (failure as Error).message);
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = setInterval(visibleRefresh, 20000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      clearTimeout(initial); clearInterval(interval); controller.current?.abort();
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh]);

  const main = data?.currentShift ?? data?.nextShift;
  const following = data?.upcomingShifts.filter((shift) => shift.key !== main?.key) ?? [];
  return <section className="employee-home" aria-label="המשמרות האישיות שלי" aria-busy={loading}>
    <div className="personal-home-heading">
      <div><h1>המשמרות שלי</h1><p>לפי הסידור שפורסם · שעון ישראל</p></div>
      <button className="button secondary" onClick={() => void refresh()} disabled={loading} aria-label="רענון המשמרות האישיות"><RefreshCw size={17} aria-hidden="true" />רענון</button>
    </div>
    {error && <div className="personal-error" role="alert"><strong>שגיאת טעינה</strong><p>{error}</p>{data && <p>מוצג המידע מהטעינה הקודמת. ייתכנו שינויים שטרם נטענו.</p>}</div>}
    {!data && !error && <p role="status">טוען את המשמרות שלך…</p>}
    {data && <>
      <article className={`personal-main-shift${data.currentShift ? " is-current" : ""}`} data-testid="personal-main-shift">
        <div className="personal-main-label"><CalendarDays size={22} aria-hidden="true" /><h2>{data.currentShift ? "משמרת נוכחית" : "המשמרת הבאה שלי"}</h2></div>
        {main ? <ShiftDetails shift={main} /> : <div className="personal-empty">
          <h3>{data.currentWeekStatus === "unpublished" ? "השבוע הנוכחי עדיין לא פורסם" : data.currentWeekStatus === "no-personal-assignment" ? "אין לך שיבוץ אישי בשבוע הנוכחי" : "אין משמרות עתידיות במידע הזמין"}</h3>
          <p>{data.currentWeekStatus === "assigned" ? "המשמרות שפורסמו עבורך כבר הסתיימו. שיבוצים חדשים יופיעו כאן לאחר פרסום." : "לא נמצאו עבורך משמרות עתידיות בסידורים שפורסמו. אפשר לבדוק את לוח הצוות או לפנות למנהל."}</p>
        </div>}
      </article>
      {main && data.currentWeekStatus !== "assigned" && <p className="personal-week-note">{data.currentWeekStatus === "unpublished" ? "השבוע הנוכחי עדיין לא פורסם. המשמרת המוצגת היא מתוך סידור שפורסם." : "אין לך שיבוץ אישי בשבוע הנוכחי. כאן מוצגות המשמרות הבאות שכבר פורסמו."}</p>}
      <section className="personal-upcoming" aria-label="משמרות קרובות">
        <h2>המשמרות הקרובות</h2>
        {following.length ? <ol>{following.map((shift) => <li key={shift.key} data-testid="personal-upcoming-shift"><ShiftDetails shift={shift} /></li>)}</ol> : <p>אין משמרות נוספות במידע שפורסם.</p>}
      </section>
      <p className="personal-data-note">נבדקו הסידורים שפורסמו{data.availableThrough ? <> עד <bdi dir="ltr">{data.availableThrough.split("-").reverse().join(".")}</bdi></> : " הזמינים"}. עודכן ב־<bdi dir="ltr">{localTime(data.checkedAt)}</bdi> בתאריך <bdi dir="ltr">{localDate(data.checkedAt).split("-").reverse().join(".")}</bdi>.</p>
    </>}
    {(onViewTeam || onViewMonth) && <nav className="personal-shortcuts" aria-label="מידע נוסף לעובד">
      {onViewTeam && <button className="button secondary" onClick={onViewTeam}>לוח הצוות</button>}
      {onViewMonth && <button className="button secondary" onClick={onViewMonth}>החודש שלי</button>}
    </nav>}
  </section>;
}
