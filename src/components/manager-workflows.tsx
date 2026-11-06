"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LockKeyhole, Sparkles } from "lucide-react";
import { coverageGaps, type CoverageGap } from "@/lib/coverage";
import { getCandidates } from "@/lib/scheduler";
import { localDate, localTime, weekDates } from "@/lib/time";
import { GROUP_LABELS, type Group, type Issue, type SchedulingProposal, type Shift, type Template, type WeekData } from "@/lib/types";
import { api } from "@/lib/utils";
import { Modal } from "./ui/dialog";
import "./manager-workflows.css";

const dateLabel = (date: string) => new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "numeric" }).format(new Date(`${date}T12:00:00Z`));
const dayOfTemplate = (template: Template) => Math.max(0, weekDates(template.sourceWeek).indexOf(localDate(template.shifts[0]?.start ?? `${template.sourceWeek}T12:00:00Z`)));
const isDaily = (template?: Template) => template && new Set(template.shifts.map(shift => localDate(shift.start))).size === 1;
type Change = { shiftId: string; before: Shift | null; after: Shift | null };

function ShiftDescription({ shift, data }: { shift: Shift; data: WeekData }) {
  return <div className="review-shift-description"><strong>{shift.title} · {GROUP_LABELS[shift.group]}</strong><span>{dateLabel(localDate(shift.start))} · <bdi>{localTime(shift.start)}–{localTime(shift.end)}</bdi>{localDate(shift.start) !== localDate(shift.end) && " · סיום ביום הבא"}</span><ul>{shift.assignments.length ? shift.assignments.map((assignment, index) => <li key={`${assignment.employeeId}-${index}`}><span>{data.employees.find(person => person.id === assignment.employeeId)?.name ?? "עובד"}</span> <bdi>{localTime(assignment.start)}–{localTime(assignment.end)}</bdi>{assignment.locked && <span className="assignment-locked"><LockKeyhole size={13} />נעול</span>}</li>) : <li>ללא שיבוצים</li>}</ul></div>;
}

export function ChangesList({ changes, data }: { changes: Change[]; data: WeekData }) {
  return <ul className="review-changes">{changes.map(change => <li key={change.shiftId}><strong className="review-change-kind">{!change.before ? "נוספה משמרת" : !change.after ? "בוטלה משמרת" : "משמרת השתנתה"}</strong><div className="review-change-pair">{change.before && <div><small>לפני</small><ShiftDescription shift={change.before} data={data} /></div>}{change.after && <div><small>אחרי</small><ShiftDescription shift={change.after} data={data} /></div>}</div></li>)}</ul>;
}

function GapCandidates({ shift, gap, data, onOpen }: { shift: Shift; gap: CoverageGap; data: WeekData; onOpen: (shift: Shift) => void }) {
  const [expanded, setExpanded] = useState(false);
  const candidates = useMemo(() => expanded ? getCandidates(shift, data.shifts, data.employees, data.rules, data.contextShifts ?? [], gap).filter(candidate => candidate.eligible).sort((a, b) => a.hours - b.hours || a.employee.name.localeCompare(b.employee.name, "he")).slice(0, 3) : [], [expanded, shift, gap, data]);
  return <details className="attention-candidates" onToggle={event => setExpanded(event.currentTarget.open)}><summary>אפשרויות להשלמת החוסר</summary><p>התאמה לפי זמינות, תפקיד, מנוחה ומכסה בכל ההתחייבויות הידועות; אין הבטחה לשיבוץ מיטבי.</p>{expanded && (candidates.length ? <div>{candidates.map(candidate => <button key={candidate.employee.id} className="candidate" onClick={() => onOpen({ ...shift, assignments: [...shift.assignments, { employeeId: candidate.employee.id, start: gap.start, end: gap.end }] })}><span><strong>{candidate.employee.name}</strong><small>מתאים לטווח <bdi>{localTime(gap.start)}–{localTime(gap.end)}</bdi> · {Math.round(candidate.hours * 10) / 10} שעות משובצות השבוע</small></span><span>בדיקה ושמירה</span></button>)}</div> : <p>אין עובד מתאים לכל הטווח החסר. פתחו את המשמרת לבדיקת חלוקת שעות או עדכון הנתונים.</p>)}</details>;
}

export function AttentionQueue({ data, expanded, onExpand, onOpen }: { data: WeekData; expanded: boolean; onExpand: () => void; onOpen: (shift: Shift) => void }) {
  const items = useMemo(() => data.shifts.map(shift => ({ shift, gaps: coverageGaps(shift), issues: data.issues.filter(issue => issue.shiftId === shift.id && !["UNDERSTAFFED", "UNDERSTAFF", "UNCOVERED"].includes(issue.code) && !issue.code.includes("COVER") && !issue.code.includes("UNFILLED")) })).filter(item => item.gaps.length || item.issues.length), [data]);
  if (!data.shifts.length) return <div className="attention-calm" role="status"><AlertCircle size={18} /><div><strong>השבוע ריק — הכיסוי טרם הוגדר</strong><p>הוסיפו משמרות או הכינו שבוע מתבנית כדי לבדוק את צורכי הצוות.</p></div></div>;
  if (!data.employees.some(employee => employee.active)) return <div className="attention-calm" role="status"><AlertCircle size={18} /><div><strong>חסרים נתוני צוות פעיל</strong><p>יש להוסיף עובדים וזמינות לפני בדיקת כיסוי.</p></div></div>;
  if (!items.length) return <div className="attention-calm" role="status"><CheckCircle2 size={18} /><div><strong>אין בעיות שיבוץ לפי הנתונים הקיימים</strong><p>לפני הפרסום בדקו את השינויים ואת צורכי הצוות.</p></div></div>;
  return <section className="attention-queue" aria-label="רשימת משימות לטיפול"><div className="attention-queue-heading"><h2>לטיפול <span>{items.length}</span></h2><small>כל השבוע · ללא תלות במסנני התצוגה</small></div><ul>{items.slice(0, expanded ? undefined : 3).map(({ shift, gaps, issues }) => {
    const gap = gaps[0];

    return <li key={shift.id}><div className="attention-item-heading"><div><strong>{shift.title} · {GROUP_LABELS[shift.group]}</strong><span>{dateLabel(localDate(shift.start))} · <bdi>{localTime(shift.start)}–{localTime(shift.end)}</bdi> · {GROUP_LABELS[shift.group]}</span></div><button className="button secondary" onClick={() => onOpen(shift)}>פתיחת משמרת</button></div><ul className="attention-problems">{gaps.map((item, index) => <li key={`gap-${index}`}><AlertCircle size={15} />{item.message}</li>)}{issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={issue.severity === "error" ? "blocking" : ""}><AlertCircle size={15} />{issue.code === "OVERLAP" && "חפיפה · "}{issue.employeeId && `${data.employees.find(person => person.id === issue.employeeId)?.name ?? "עובד"}: `}{issue.message}</li>)}</ul>{gap && <GapCandidates shift={shift} gap={gap} data={data} onOpen={onOpen} />}</li>;
  })}</ul>{items.length > 3 && <button className="text-button" onClick={onExpand}>{expanded ? "הצגת רשימה מצומצמת" : `הצגת כל ${items.length} המשמרות לטיפול`}</button>}</section>;
}

export function SmartScheduleDialog({ data, templates, templatesError, selectedTemplate, initialTarget, initialGroups, onSelectTemplate, onCreateTemplate, onClose, onApplied }: { data: WeekData; templates: Template[]; templatesError?: string; selectedTemplate: string; initialTarget?: string; initialGroups?: Group[]; onSelectTemplate: (id: string) => void; onCreateTemplate: () => void; onClose: () => void; onApplied: (value: WeekData) => void }) {
  const template = templates.find(item => item.id === selectedTemplate);
  const [mode, setMode] = useState<"fill" | "repair">("fill");
  const [days, setDays] = useState<number[]>(() => isDaily(template) && initialTarget !== "all" ? [initialTarget === undefined ? dayOfTemplate(template!) : Number(initialTarget)] : [0, 1, 2, 3, 4, 5, 6]);
  const [groups, setGroups] = useState<Group[]>(initialGroups ?? ["MANAGERS", "PATROL"]);
  const [proposal, setProposal] = useState<SchedulingProposal | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const dates = weekDates(data.weekStart);
  const allDays = days.length === 7;
  const shortDate = (date: string) => new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  const dayDescription = allDays ? `כל השבוע (${shortDate(dates[0])}–${shortDate(dates[6])})` : days.map(day => dateLabel(dates[day])).join(" · ") || "לא נבחרו ימים";
  const scopeDescription = `${dayDescription} · ${groups.map(group => GROUP_LABELS[group]).join(" ו") || "לא נבחרו צוותים"}`;
  const [showTemplateUpfront] = useState(() => !data.shifts.length || !!selectedTemplate);
  const invalidScope = !days.length || !groups.length;
  const templateControls = <div className="smart-template-controls">
    <label>תבנית<select aria-label="תבנית לשבוע" disabled={pending} value={selectedTemplate} onChange={event => {
      const next = templates.find(item => item.id === event.target.value);
      onSelectTemplate(event.target.value);
      if (isDaily(next)) setDays([dayOfTemplate(next!)]);
    }}><option value="">{data.shifts.length ? "המשמרות שכבר בלוח" : "בחרו תבנית"}</option>{templates.map(item => <option value={item.id} key={item.id}>{item.name}{isDaily(item) ? " · יומית" : " · שבועית"}</option>)}</select></label>
    <button className="text-button" disabled={pending} onClick={onCreateTemplate}>יצירת תבנית</button>
  </div>;
  async function preview() {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError("");
    try { setProposal(await api<SchedulingProposal>("/api/weeks/auto", "POST", { weekStart: data.weekStart, revision: data.revision, mode, scope: { days, groups }, ...(selectedTemplate ? { templateId: selectedTemplate } : {}) })); }
    catch (cause) { setError(`ההצעה לא נוצרה. ${(cause as Error).message}`); }
    finally { pendingRef.current = false; setPending(false); }
  }
  async function apply() {
    if (!proposal || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError("");
    try { const result = await api<WeekData>("/api/weeks/auto/apply", "POST", { proposalId: proposal.id }); onApplied(result); }
    catch (cause) { setError(`לא נשמר. ${(cause as Error).message}`); }
    finally { pendingRef.current = false; setPending(false); }
  }
  function cancel() { if (pendingRef.current) return; if (proposal) void api("/api/weeks/auto", "DELETE", { proposalId: proposal.id }).catch(() => {}); onClose(); }
  const changedIds = new Set(proposal?.changes.map(change => change.shiftId));
  return <Modal open wide={!!proposal} title={proposal ? "תצוגה מקדימה לשיבוץ" : "שיבוץ חכם"} description={proposal ? "זו ההצעה לבדיקה. עדיין לא נשמר או פורסם דבר." : "נכין הצעה לבדיקה. שום דבר לא נשמר בלי אישור שלך."} onClose={cancel}>
    <div className="editor-body workflow-review smart-setup">
      <div className="smart-scope-summary" aria-label="סיכום הבחירה">
        <strong>{mode === "fill" ? "השלמת חוסרים" : "תיקון שיבוצים"}</strong>
        <p>{scopeDescription}</p>
        {template && !showTemplateUpfront && !proposal && <p>תבנית: {template.name}</p>}
        <small>{mode === "fill" ? "השיבוצים הקיימים נשארים. משלימים רק את מה שחסר." : "שיבוצים שאינם נעולים עשויים להשתנות. השינויים יוצגו לבדיקה."}</small>
      </div>
      {templatesError && <p className="notice error" role="alert">לא ניתן לטעון תבניות: {templatesError}</p>}
      {!proposal ? <>
        {showTemplateUpfront && <div>{!data.shifts.length && !selectedTemplate && <p className="form-help">השבוע עדיין ריק. בחרו תבנית כדי להתחיל.</p>}{templateControls}</div>}
        {template && <p className="notice warning">התבנית תחול רק בימים ובצוותים שנבחרו. החלפת משמרות קיימות דורשת בחירה במצב תיקון.</p>}
        <details className="smart-more-options">
          <summary>אפשרויות נוספות</summary>
          <div className="smart-options-content">
            <fieldset disabled={pending}><legend>ימים לשינוי</legend><div className="scope-options">
              <label className="check-label"><input type="checkbox" checked={allDays} onChange={event => setDays(event.target.checked ? [0, 1, 2, 3, 4, 5, 6] : [])} />כל השבוע</label>
              {dates.map((date, day) => <label key={date} className="check-label"><input type="checkbox" checked={days.includes(day)} onChange={event => setDays(current => event.target.checked ? [...current, day].sort() : current.filter(value => value !== day))} />{dateLabel(date)}</label>)}
            </div></fieldset>
            <fieldset disabled={pending}><legend>צוותים לשינוי</legend><div className="scope-options">{(["MANAGERS", "PATROL"] as Group[]).map(group => <label key={group} className="check-label"><input type="checkbox" checked={groups.includes(group)} onChange={event => setGroups(current => event.target.checked ? [...current, group] : current.filter(value => value !== group))} />{GROUP_LABELS[group]}</label>)}</div></fieldset>
            <fieldset disabled={pending}><legend>אופן השיבוץ</legend>
              <label className="workflow-radio"><input type="radio" name="schedule-mode" value="fill" checked={mode === "fill"} onChange={() => setMode("fill")} /><span><strong>השלמת חוסרים</strong><small>ללא שינוי בשיבוצים הקיימים.</small></span></label>
              <label className="workflow-radio"><input type="radio" name="schedule-mode" value="repair" checked={mode === "repair"} onChange={() => setMode("repair")} /><span><strong>תיקון שיבוצים — מתקדם</strong><small>מאפשר להציע שינוי בשיבוצים שאינם נעולים.</small></span></label>
            </fieldset>
            {!showTemplateUpfront && templateControls}
            <p className="form-help">מסנני הלוח לא משנים את הבחירה כאן. כל השיבוצים נבדקים מול הכללים, גם בצוותים ובשבועות אחרים. נעילות נשמרות; סתירות לכללים יוצגו לטיפול.</p>
          </div>
        </details>
        {invalidScope && <p className="notice warning" role="status">בחרו לפחות יום אחד וצוות אחד באפשרויות הנוספות.</p>}
      </> : <>
        {template && <p className="form-help">תבנית: {template.name}</p>}
        <div className="proposal-summary" role="status"><strong>{proposal.summary.addedAssignments} שיבוצים יתווספו</strong><span>{proposal.summary.changedAssignments} שיבוצים ישתנו</span><span>{proposal.summary.unchangedAssignments} שיבוצים יישארו</span><span>{proposal.summary.unfilledShifts} משמרות יישארו עם חוסר</span></div>
        <h3>השינויים המוצעים</h3>{proposal.changes.length ? <ChangesList changes={proposal.changes} data={data} /> : <p>לא מוצעים שינויים בשיבוצים.</p>}
        <details><summary>משמרות שיישארו ללא שינוי</summary><div className="review-unchanged">{proposal.shifts.filter(shift => !changedIds.has(shift.id)).map(shift => <ShiftDescription shift={shift} data={data} key={shift.id} />)}</div></details>
        <h3>בעיות שלא נפתרו</h3>{proposal.issues.length ? <ul className="review-issues">{proposal.issues.map((issue, index) => <li key={index} className={issue.severity === "error" ? "blocking" : ""}><strong>{proposal.shifts.find(shift => shift.id === issue.shiftId)?.title}</strong> · {issue.employeeId && `${data.employees.find(person => person.id === issue.employeeId)?.name ?? "עובד"}: `}{issue.message}</li>)}</ul> : <p>לא נמצאו בעיות לפי הנתונים והכללים הנוכחיים.</p>}
        <p className="form-help">החלה תשמור את ההצעה הזאת בטיוטה בלבד. שינוי בנתונים מאז יצירתה יחייב הצעה חדשה. ניתן לבטל את ההחלה בהיסטוריית השבוע.</p>
      </>}
      {error && <div role="alert" className="notice error">{error}</div>}
    </div>
    <div className="dialog-footer smart-schedule-footer">
      <button className="button secondary" disabled={pending} onClick={cancel}>ביטול</button>
      {proposal && <button className="button secondary" disabled={pending} onClick={() => { void api("/api/weeks/auto", "DELETE", { proposalId: proposal.id }).catch(() => {}); setProposal(null); setError(""); }}>שינוי הבחירה</button>}
      <button className="button primary" disabled={pending || invalidScope || (!selectedTemplate && !data.shifts.length)} onClick={() => void (proposal ? apply() : preview())}><Sparkles size={17} />{pending ? "בודק…" : proposal ? "החלה על הטיוטה" : "יצירת הצעה לבדיקה"}</button>
    </div>
  </Modal>;
}

type PublicationReview = { revision: number; publishedRevision: number | null; reviewToken: string; changes: Change[]; affectedEmployees: { id: string; name: string }[]; issues: Issue[]; shortages: Issue[] };
export function PublicationDialog({ data, onClose, onOpenShift, onPublished }: { data: WeekData; onClose: () => void; onOpenShift: (shift: Shift) => void; onPublished: (value: WeekData) => void }) {
  const [review, setReview] = useState<PublicationReview | null>(null);
  const [error, setError] = useState("");
  const [allowUnderstaffed, setAllowUnderstaffed] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  useEffect(() => { let active = true; api<PublicationReview>(`/api/weeks/publish?week=${data.weekStart}`).then(value => { if (active) setReview(value); }).catch(cause => { if (active) setError((cause as Error).message); }); return () => { active = false; }; }, [data.weekStart]);
  const blockers = review?.issues.filter(issue => issue.severity === "error") ?? [];
  async function publish() {
    if (!review || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError("");
    try { onPublished(await api<WeekData>("/api/weeks/publish", "POST", { weekStart: data.weekStart, revision: review.revision, reviewToken: review.reviewToken, allowUnderstaffed })); }
    catch (cause) { setError(`לא פורסם. ${(cause as Error).message}`); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <Modal open wide title="בדיקה לפני פרסום" description="עדכון אישי יוצג במערכת לעובדים שהסידור שלהם השתנה. לא נשלחות הודעות חיצוניות; פתיחת העדכון ואישור קראתי מתועדים בנפרד." onClose={() => !pendingRef.current && onClose()}><div className="editor-body workflow-review">{!review && !error && <p role="status">טוען השוואה לפרסום הקודם…</p>}{review && <><h3>הבדלים מהפרסום האחרון</h3>{review.changes.length ? <ChangesList changes={review.changes} data={data} /> : <p>אין שינוי במשמרות לעומת הפרסום הקודם.</p>}<h3>עובדים שהשינוי נוגע להם</h3><p>{review.affectedEmployees.map(person => person.name).join(" · ") || "אין שינוי בשיבוצים אישיים"}</p>{blockers.length > 0 && <div className="notice error"><strong>יש לתקן לפני הפרסום</strong><ul className="review-issues">{blockers.map((issue, index) => { const shift = data.shifts.find(item => item.id === issue.shiftId); return <li key={index}>{shift?.title}: {issue.message}{shift && <button className="text-button" disabled={pending} onClick={() => { onClose(); onOpenShift(shift); }}>פתיחת המשמרת לתיקון</button>}</li>; })}</ul></div>}{review.shortages.length > 0 && <div className="notice warning"><strong>חוסרים שנותרו</strong><ul className="review-issues">{review.shortages.map((issue, index) => <li key={index}>{data.shifts.find(shift => shift.id === issue.shiftId)?.title}: {issue.message}</li>)}</ul><label className="check-label"><input type="checkbox" checked={allowUnderstaffed} disabled={pending} onChange={event => setAllowUnderstaffed(event.target.checked)} />אני מאשר/ת לפרסם עם החוסרים המפורטים. האישור יישמר בהיסטוריה ואינו עוקף שגיאות חוסמות.</label></div>}{!data.shifts.length && <p className="notice warning">הטיוטה ריקה. פרסום שלה יסיר מהלוח לעובדים את המשמרות שפורסמו קודם.</p>}</>}{error && <div className="notice error" role="alert">{error}</div>}</div><div className="dialog-footer"><button className="button secondary" disabled={pending} onClick={onClose}>חזרה לטיוטה</button><button className="button primary" disabled={pending || !review || blockers.length > 0 || (!!review?.shortages.length && !allowUnderstaffed)} onClick={() => void publish()}>{pending ? "מפרסם…" : "פרסום לצוות"}</button></div></Modal>;
}
