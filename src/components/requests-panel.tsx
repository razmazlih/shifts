"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCw, Send } from "lucide-react";
import { api } from "@/lib/utils";
import { localDate, localTime, localToISO, today } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import type { EmployeeRequestView, RequestAction, RequestKind, RequestStatus } from "@/lib/employee-requests";
import "./requests-panel.css";

const labels: Record<RequestStatus, string> = { PENDING: "ממתין", APPROVED: "אושר", REJECTED: "נדחה", CANCELLED: "בוטל" };
const kindLabel = (kind: RequestKind) => kind === "ABSENCE" ? "בקשת היעדרות" : "אילוץ אי־זמינות";
const dateLabel = (iso: string) => new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short", day: "numeric", month: "numeric", year: "numeric" }).format(new Date(iso));
function Period({ start, end }: { start: string; end: string }) {
  return <p className="request-period">{dateLabel(start)} · <bdi dir="ltr">{localTime(start)}</bdi><span> עד </span>{localDate(end) !== localDate(start) && <>{dateLabel(end)} · </>}<bdi dir="ltr">{localTime(end)}</bdi></p>;
}

export function RequestsPanel({ user, onScheduleChanged, onOpenWeek }: {
  user: SessionUser; onScheduleChanged?: () => void; onOpenWeek?: (week: string) => void;
}) {
  const admin = user.role === "ADMIN";
  const [requests, setRequests] = useState<EmployeeRequestView[]>([]);
  const [filter, setFilter] = useState<RequestStatus | "ALL">(admin ? "PENDING" : "ALL");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [kind, setKind] = useState<RequestKind>("ABSENCE");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("16:00");
  const [reason, setReason] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [withdrawId, setWithdrawId] = useState<string | null>(null);
  const submissionKey = useRef<string | null>(null);
  const sending = useRef(false);
  const generation = useRef(0);
  const reload = useCallback(async (cursor?: string) => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: filter, ...(cursor ? { cursor } : {}) });
      const value = await api<{ requests: EmployeeRequestView[]; nextCursor: string | null }>(`/api/requests?${params}`);
      if (current === generation.current) { setRequests(previous => cursor ? [...previous, ...value.requests.filter(item => !previous.some(existing => existing.id === item.id))] : value.requests); setNextCursor(value.nextCursor); setLoaded(true); setError(""); }
    } catch (failure) {
      if (current === generation.current) setError(`לא ניתן לטעון את הבקשות. ${(failure as Error).message}`);
    } finally { if (current === generation.current) setLoading(false); }
  }, [filter]);
  useEffect(() => {
    const initial = setTimeout(() => void reload(), 0);
    return () => { clearTimeout(initial); generation.current += 1; };
  }, [reload]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    generation.current += 1; setLoading(false);
    sending.current = true; setBusyId("new"); setError(""); setNotice("");
    try {
      submissionKey.current ??= crypto.randomUUID();
      const start = localToISO(startDate, startTime), end = localToISO(endDate, endTime);
      if (Date.parse(end) <= Date.parse(start)) throw new Error("מועד הסיום חייב להיות אחרי מועד ההתחלה. למשמרת לילה בחרו תאריך סיום ביום הבא.");
      const result = await api<{ request: EmployeeRequestView }>("/api/requests", "POST", { submissionKey: submissionKey.current, kind, start, end, reason });
      setRequests(previous => [result.request, ...previous.filter(item => item.id !== result.request.id)]);
      setLoaded(true); setReason(""); submissionKey.current = null;
      setNotice("הבקשה נשמרה וממתינה להחלטת מנהל. סידור העבודה לא השתנה.");
    } catch (failure) { setError(`לא נשמר — ${(failure as Error).message}. הפרטים נשמרו בטופס לניסיון נוסף.`); }
    finally { sending.current = false; setBusyId(""); }
  }
  async function decide(request: EmployeeRequestView, action: RequestAction) {
    if (sending.current) return;
    generation.current += 1; setLoading(false);
    sending.current = true; setBusyId(request.id); setError(""); setNotice("");
    try {
      const result = await api<{ request: EmployeeRequestView }>("/api/requests", "PATCH", { id: request.id, revision: request.revision, action, decisionNote: decisionNotes[request.id] ?? "" });
      setRequests(previous => previous.map(item => item.id === request.id ? { ...result.request, employeeName: item.employeeName, impacts: item.impacts } : item));
      setWithdrawId(null);
      setNotice(action === "approve" ? "הבקשה אושרה והאילוץ נשמר. יש לטפל בשיבוצים המושפעים ולפרסם שינוי בנפרד." : request.status === "APPROVED" ? "האישור בוטל והאילוץ של הבקשה הוסר. הסידור שפורסם לא השתנה." : "החלטת הבקשה נשמרה. סידור העבודה לא השתנה.");
      if (action === "approve" || request.status === "APPROVED") onScheduleChanged?.();
    } catch (failure) { setError(`לא נשמר — ${(failure as Error).message}. הערת ההחלטה נשארה בטופס.`); }
    finally { sending.current = false; setBusyId(""); }
  }
  const visible = requests.filter(request => filter === "ALL" || request.status === filter);
  return <section className="requests-panel" aria-label={admin ? "בקשות עובדים" : "הבקשות שלי"}>
    <header className="requests-heading"><div><h1>{admin ? "בקשות עובדים" : "הבקשות שלי"}</h1><p>{admin ? "החלטה בבקשה מעדכנת את האילוצים. שינוי סידור ופרסום נעשים בנפרד." : "בקשת היעדרות או אי־זמינות לפי תאריך ושעות. ההגשה אינה משנה את השיבוץ שלך."}</p></div><button className="button secondary" disabled={loading || !!busyId} onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" />רענון בקשות</button></header>
    {error && <div className="notice error" role="alert">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    {!admin && <form className="request-form" onSubmit={submit}>
      <h2>בקשה חדשה</h2>
      <label>סוג בקשה<select value={kind} onChange={event => setKind(event.target.value as RequestKind)}><option value="ABSENCE">היעדרות</option><option value="CONSTRAINT">אי־זמינות בשעות מסוימות</option></select></label>
      <div className="request-date-fields"><label>תאריך התחלה<input required type="date" value={startDate} onChange={event => { if (endDate === startDate) setEndDate(event.target.value); setStartDate(event.target.value); }} /></label><label>שעת התחלה<input required type="time" dir="ltr" value={startTime} onChange={event => setStartTime(event.target.value)} /></label><label>תאריך סיום<input required type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label><label>שעת סיום<input required type="time" dir="ltr" value={endTime} onChange={event => setEndTime(event.target.value)} /></label></div>
      <p className="request-help">כל השעות לפי שעון ישראל. לבקשה שחוצה חצות בחרו תאריך סיום ביום הבא.</p>
      <label>הסבר למנהל (לא חובה)<textarea value={reason} maxLength={500} rows={3} onChange={event => setReason(event.target.value)} /><small>ההסבר גלוי רק לך ולמנהלים.</small></label>
      <button type="submit" className="button primary" disabled={!!busyId}><Send size={16} aria-hidden="true" />{busyId === "new" ? "שומר בקשה…" : "שליחת בקשה"}</button>
    </form>}
    <div className="request-list-heading"><h2>{admin ? "תור הבקשות" : "הבקשות שהגשתי"}</h2><label>סטטוס<select aria-label="סינון בקשות לפי סטטוס" value={filter} onChange={event => setFilter(event.target.value as RequestStatus | "ALL")}><option value="ALL">כל הבקשות</option>{Object.entries(labels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label></div>
    {loading && <p role="status">טוען בקשות…</p>}
    {!loading && loaded && visible.length === 0 && <p className="request-empty">{filter === "PENDING" ? "אין כרגע בקשות שממתינות להחלטה." : "אין בקשות להצגה בסטטוס שנבחר."}</p>}
    <div className="request-list">{visible.map(request => <article className="request-card" key={request.id} data-testid="employee-request">
      <div className="request-card-title"><h3>{admin ? `${request.employeeName ?? "עובד"} · ` : ""}{kindLabel(request.kind)}</h3><span className={`request-status status-${request.status.toLowerCase()}`}>{labels[request.status]}</span></div>
      <Period start={request.start} end={request.end} />
      {request.reason && <p className="request-reason">{request.reason}</p>}
      {request.decisionNote && <p className="request-decision"><strong>הערת החלטה: </strong>{request.decisionNote}</p>}
      {admin && <section className="request-impacts" aria-label="שיבוצים מושפעים"><h4>שיבוצים מושפעים</h4>{request.impacts?.length ? <ul>{request.impacts.map((impact, index) => <li key={`${impact.source}-${impact.shiftId}-${index}`}><div><strong>{impact.title}</strong> · {impact.source === "published" ? "סידור שפורסם" : "טיוטה"}<Period start={impact.start} end={impact.end} /></div>{onOpenWeek && <button className="text-button" onClick={() => onOpenWeek(impact.weekStart)}><CalendarDays size={14} aria-hidden="true" />פתיחת השבוע</button>}</li>)}</ul> : <p>לא נמצאו שיבוצים חופפים בטיוטות ובפרסומים הזמינים.</p>}</section>}
      {admin && (request.status === "PENDING" || withdrawId === request.id) && <label>הערה להחלטה (גלויה לעובד)<textarea rows={2} maxLength={1000} value={decisionNotes[request.id] ?? ""} onChange={event => setDecisionNotes(previous => ({ ...previous, [request.id]: event.target.value }))} /></label>}
      <div className="request-actions">
        {request.status === "PENDING" && (admin ? <><button className="button primary" disabled={!!busyId} onClick={() => void decide(request, "approve")}>אישור הבקשה</button><button className="button secondary" disabled={!!busyId} onClick={() => void decide(request, "reject")}>דחיית הבקשה</button></> : <button className="button secondary" disabled={!!busyId} onClick={() => void decide(request, "cancel")}>ביטול הבקשה</button>)}
        {request.status === "APPROVED" && (admin ? withdrawId === request.id ? <><p>הביטול יסיר רק את האילוץ שנוצר מהבקשה הזאת. סידור שפורסם יישאר כפי שהוא.</p><button className="button danger" disabled={!!busyId} onClick={() => void decide(request, "cancel")}>אישור ביטול האישור</button><button className="button secondary" disabled={!!busyId} onClick={() => setWithdrawId(null)}>חזרה</button></> : <button className="text-button" onClick={() => setWithdrawId(request.id)}>ביטול האישור</button> : <p className="request-help">לביטול בקשה שאושרה יש לפנות למנהל. הסידור שפורסם נשאר ללא שינוי עד לפרסום נוסף.</p>)}
      </div>
      <details className="request-history"><summary>היסטוריית הבקשה</summary><ol>{request.history.map(event => <li key={event.revision}>{labels[event.status]} · {dateLabel(event.at)} <bdi dir="ltr">{localTime(event.at)}</bdi>{event.note && <> · {event.note}</>}</li>)}</ol></details>
    </article>)}</div>
    {nextCursor && <button className="button secondary" disabled={loading || !!busyId} onClick={() => void reload(nextCursor)}>טעינת בקשות נוספות</button>}
  </section>;
}
