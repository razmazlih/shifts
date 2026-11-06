"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { personalShiftEndLabel } from "@/lib/personal-schedule";
import { localTime } from "@/lib/time";
import type { PersonalPublishedWork } from "@/lib/publication-diff";
import type { PersonalUpdate, PersonalUpdatesPage } from "@/lib/publication-notifications";
import "./employee-updates.css";

const dateLabel = (value: string) => new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long", year: "numeric",
}).format(new Date(value));
function WorkPeriods({ periods }: { periods: PersonalPublishedWork[] }) {
  return <ul className="update-work-periods">{periods.map((period, index) => <li key={index}>
    <strong>{period.title} · {period.group === "PATROL" ? "סייר" : "אחמ״ש"}</strong>
    <span>{dateLabel(period.start)} · <bdi dir="ltr">{localTime(period.start)}–{localTime(period.end)}</bdi>
      {personalShiftEndLabel(period) && <> · {personalShiftEndLabel(period)} ({dateLabel(period.end)})</>}
    </span>
  </li>)}</ul>;
}

export function EmployeeUpdates() {
  const [updates, setUpdates] = useState<PersonalUpdate[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const loadController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const load = useCallback(async (cursor?: string) => {
    loadController.current?.abort();
    const request = new AbortController(); loadController.current = request;
    setLoading(true);
    try {
      const response = await fetch(`/api/me/updates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: request.signal });
      if (!response.ok) throw new Error("לא ניתן לטעון את העדכונים כרגע.");
      const result: PersonalUpdatesPage = await response.json();
      if (request.signal.aborted) return;
      setUpdates(current => {
        const received = new Set(result.updates.map(update => update.id));
        // Retain older pages and the reader's expanded items during refresh.
        return cursor ? [...current.filter(update => !received.has(update.id)), ...result.updates]
          : [...result.updates, ...current.filter(update => !received.has(update.id))];
      });
      setNextCursor(result.nextCursor); setAwaiting(result.awaitingAcknowledgement); setLoaded(true); setError("");
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof TypeError ? "אין חיבור לשרת. לא ניתן לוודא שכל העדכונים נטענו." : (failure as Error).message);
    } finally { if (!request.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => void load(), 0);
    const refreshVisible = () => { if (document.visibilityState === "visible") void load(); };
    const interval = setInterval(refreshVisible, 20000);
    window.addEventListener("focus", refreshVisible);
    return () => { mounted.current = false; clearTimeout(initial); clearInterval(interval); window.removeEventListener("focus", refreshVisible); loadController.current?.abort(); };
  }, [load]);

  async function mark(update: PersonalUpdate, action: "open" | "acknowledge") {
    if (inFlight.current.has(update.id) || (action === "open" && update.openedAt) || (action === "acknowledge" && update.acknowledgedAt)) return;
    inFlight.current.add(update.id); setPending(new Set(inFlight.current));
    try {
      const response = await fetch("/api/me/updates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: update.id, action }) });
      const result = await response.json() as { update?: PersonalUpdate; error?: string };
      if (!response.ok || !result.update) throw new Error(result.error ?? "השמירה נכשלה");
      if (!mounted.current) return;
      // A refresh started before this write may still contain null receipts.
      // Discard it so an older read cannot undo the confirmed state in the UI.
      loadController.current?.abort();
      setLoading(false);
      const updated = result.update;
      setUpdates(current => current.map(item => item.id === updated.id ? updated : item));
      if (action === "acknowledge" && !update.acknowledgedAt) setAwaiting(current => Math.max(0, current - 1));
      setSaveErrors(current => ({ ...current, [update.id]: "" }));
    } catch {
      if (mounted.current) setSaveErrors(current => ({ ...current, [update.id]: "לא נשמר — החיבור לשרת נכשל. אפשר לנסות שוב; העדכון נשאר כאן." }));
    } finally { inFlight.current.delete(update.id); if (mounted.current) setPending(new Set(inFlight.current)); }
  }

  return <section className="employee-updates" aria-label="העדכונים שלי">
    <div className="employee-updates-heading"><div><h2><Bell size={20} aria-hidden="true" />עדכונים בסידור שלי</h2>{loaded && awaiting > 0 && <p>{awaiting} עדכונים ממתינים לאישור קריאה</p>}</div>
      <button type="button" className="button secondary" disabled={loading} onClick={() => void load()} aria-label="רענון העדכונים האישיים"><RefreshCw size={16} aria-hidden="true" />רענון</button>
    </div>
    <p className="updates-explanation">עדכונים לאחר פרסום בלבד. ״קראתי״ הוא אישור קריאה, ואינו דיווח נוכחות או אישור הגעה.</p>
    {error && <p className="notice error" role="alert">{error}{loaded && " מוצג מידע מהטעינה הקודמת."}</p>}
    {!loaded && !error && <p role="status">טוען עדכונים…</p>}
    {loaded && !updates.length && !error && <p className="updates-empty">אין עדכונים אישיים מאז הפעלת העדכונים במערכת.</p>}
    <div className="employee-updates-list">{updates.map(update => <details key={update.id} className={`personal-update${update.acknowledgedAt ? " acknowledged" : ""}`} onToggle={event => {
      if (event.currentTarget.open) void mark(update, "open");
    }}>
      <summary><span><strong>עדכון בסידור שלי · שבוע <bdi dir="ltr">{update.weekStart.split("-").reverse().join(".")}</bdi></strong><small>פורסם {dateLabel(update.publishedAt)} ב־<bdi dir="ltr">{localTime(update.publishedAt)}</bdi> · {update.changes.length} {update.changes.length === 1 ? "משמרת" : "משמרות"}</small></span>
        <span className="update-read-status">{update.acknowledgedAt ? <><CheckCheck size={16} aria-hidden="true" />אושר שקראתי</> : update.openedAt ? "נפתח · טרם אושר שקראתי" : "טרם נפתח"}</span>
      </summary>
      <div className="personal-update-content">{update.changes.map(change => <article className="personal-update-change" key={change.shiftId}>
        <h3>{change.kind === "added" ? "משמרת נוספה" : change.kind === "canceled" ? "משמרת בוטלה" : "משמרת שונתה"}</h3>
        {change.kind === "changed" && <><p className="update-comparison-label">לפני השינוי</p><WorkPeriods periods={change.before} /><p className="update-comparison-label">לאחר השינוי</p></>}
        <WorkPeriods periods={change.kind === "canceled" ? change.before : change.after} />
      </article>)}
      {saveErrors[update.id] && <p role="alert" className="notice error">{saveErrors[update.id]}</p>}
      {update.acknowledgedAt ? <p className="update-acknowledgement">אישרת שקראת ב־<bdi dir="ltr">{localTime(update.acknowledgedAt)}</bdi> · {dateLabel(update.acknowledgedAt)}</p> : <button type="button" className="button primary" disabled={pending.has(update.id)} onClick={() => void mark(update, "acknowledge")}>{pending.has(update.id) ? "שומר…" : "קראתי"}</button>}
      </div>
    </details>)}</div>
    {nextCursor && <button type="button" className="button secondary updates-load-more" disabled={loading} onClick={() => void load(nextCursor)}>עדכונים קודמים</button>}
  </section>;
}
