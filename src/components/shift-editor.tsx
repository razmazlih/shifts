"use client";
import { useState } from "react";
import {
  Plus,
  Trash2,
  Copy,
  AlertTriangle,
  Search,
  Check,
  Users,
} from "lucide-react";
import { Modal } from "./ui/dialog";
import { ShiftFields } from "./shift-fields";
import { type Shift, type WeekData, type Assignment } from "@/lib/types";
import { localDate, localTime, localToISO } from "@/lib/time";
import { getCandidates, validateSchedule } from "@/lib/scheduler";
const toInput = (iso: string) => `${localDate(iso)}T${localTime(iso)}`;
function fromInput(value: string) {
  const [date, time] = value.split("T");
  try {
    return localToISO(date, time);
  } catch {
    throw new Error(
      "התאריך או השעה אינם תקינים, או שנבחרה שעה חסרה/כפולה במעבר שעון קיץ. בחרו שעה חד־משמעית אחרת.",
    );
  }
}
export function ShiftEditor({
  shift,
  data,
  isNew,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  shift: Shift;
  data: WeekData;
  isNew: boolean;
  onClose: () => void;
  onSave: (shift: Shift, duplicate?: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Shift>(structuredClone(shift));
  const [start, setStart] = useState(toInput(shift.start));
  const [end, setEnd] = useState(toInput(shift.end));
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [segmentStart, setSegmentStart] = useState(toInput(shift.start));
  const [segmentEnd, setSegmentEnd] = useState(toInput(shift.end));
  let candidateShift = draft;
  let segmentValid = true;
  if (advanced) {
    try {
      const s = fromInput(segmentStart),
        e = fromInput(segmentEnd);
      segmentValid =
        Date.parse(s) >= Date.parse(draft.start) &&
        Date.parse(e) <= Date.parse(draft.end) &&
        Date.parse(e) > Date.parse(s);
      candidateShift = {
        ...draft,
        id: `${draft.id}-candidate`,
        start: s,
        end: e,
        assignments: [],
      };
    } catch {
      segmentValid = false;
    }
  }
  const candidates = segmentValid
    ? getCandidates(
        candidateShift,
        [...data.shifts.filter((s) => s.id !== draft.id), draft],
        data.employees,
        data.rules,
        data.contextShifts ?? [],
      ).filter(
        (c) => !draft.assignments.some((a) => a.employeeId === c.employee.id),
      )
    : [];
  const issues = validateSchedule(
    [...data.shifts.filter((s) => s.id !== draft.id), draft],
    data.employees,
    data.rules,
    data.contextShifts ?? [],
  ).filter((i) => i.shiftId === draft.id);
  function assign(employeeId: string) {
    setDraft((d) => ({
      ...d,
      assignments: [
        ...d.assignments,
        {
          employeeId,
          start: advanced ? fromInput(segmentStart) : d.start,
          end: advanced ? fromInput(segmentEnd) : d.end,
        },
      ],
    }));
  }
  function updateAssignment(
    index: number,
    which: "start" | "end",
    value: string,
  ) {
    try {
      const iso = fromInput(value);
      setDraft((d) => ({
        ...d,
        assignments: d.assignments.map((a, i) =>
          i === index ? { ...a, [which]: iso } : a,
        ),
      }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(duplicate = false) {
    setError("");
    try {
      const s = fromInput(start),
        e = fromInput(end);
      if (new Date(e) <= new Date(s))
        throw new Error(
          "סיום המשמרת חייב להיות אחרי ההתחלה. במשמרת לילה בחרו את תאריך המחר.",
        );
      await onSave({ ...draft, start: s, end: e }, duplicate);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "משמרת חדשה" : "פרטי המשמרת"}
      description="בוחרים יום וסוג משמרת, ושומרים."
      wide
    >
      <div className="editor-body">
        <ShiftFields
          draft={draft}
          week={data.weekStart}
          onChange={(next) => {
            setStart(toInput(next.start));
            setEnd(toInput(next.end));
            setDraft((previous) => ({
              ...next,
              assignments: previous.assignments.map((a) => ({
                ...a,
                start: a.start === previous.start ? next.start : a.start,
                end: a.end === previous.end ? next.end : a.end,
              })),
            }));
          }}
        />
        <details className="shift-disclosure shift-staff">
          <summary>
            <span><Users size={17} /><strong>שיבוץ עובדים</strong><span className="count">{draft.assignments.length} / {draft.required}</span></span>
            <small>{draft.assignments.length ? draft.assignments.map((a) => data.employees.find((e) => e.id === a.employeeId)?.name || "עובד לא זמין").join(", ") : "אפשר גם בהמשך"}</small>
          </summary>
          <section className="assignment-section">
            <div className="section-line">
              <h3>
                <Users size={17} />
                הצוות במשמרת{" "}
                <span className="count">
                  {draft.assignments.length} / {draft.required}
                </span>
              </h3>
              <button
                className="text-button"
                onClick={() => {
                  if (!advanced) {
                    setSegmentStart(toInput(draft.start));
                    setSegmentEnd(toInput(draft.end));
                  }
                  setAdvanced(!advanced);
                }}
              >
                {advanced ? "הסתרת שעות אישיות" : "שיבוץ לחלק מהמשמרת"}
              </button>
            </div>
            {draft.assignments.length === 0 ? (
              <div className="empty-assignees">
                עדיין אין עובדים במשמרת. בחרו מהרשימה למטה.
              </div>
            ) : (
              draft.assignments.map((assignment: Assignment, index: number) => (
                <div
                  className="assignee-row"
                  key={`${assignment.employeeId}-${index}`}
                >
                  <span className="avatar small">
                    {data.employees
                      .find((e) => e.id === assignment.employeeId)
                      ?.name.charAt(0) || "?"}
                  </span>
                  <strong>
                    {data.employees.find((e) => e.id === assignment.employeeId)
                      ?.name || "עובד לא זמין"}
                  </strong>
                  {advanced ? (
                    <div className="assignment-times">
                      <input
                        aria-label="תחילת שיבוץ"
                        type="datetime-local"
                        dir="ltr"
                        value={toInput(assignment.start)}
                        onChange={(e) =>
                          updateAssignment(index, "start", e.target.value)
                        }
                      />
                      <input
                        aria-label="סיום שיבוץ"
                        type="datetime-local"
                        dir="ltr"
                        value={toInput(assignment.end)}
                        onChange={(e) =>
                          updateAssignment(index, "end", e.target.value)
                        }
                      />
                    </div>
                  ) : (
                    <span className="muted assignment-hours" dir="ltr">
                      {localTime(assignment.start)} – {localTime(assignment.end)}
                    </span>
                  )}
                  <button
                    className="icon-button danger"
                    aria-label="הסרת עובד מהמשמרת"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        assignments: draft.assignments.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
            <>
              {advanced && (
                <div className="segment-picker">
                  <div className="form-grid">
                    <label>
                      תחילת החלק לשיבוץ
                      <input
                        type="datetime-local"
                        dir="ltr"
                        value={segmentStart}
                        onChange={(e) => setSegmentStart(e.target.value)}
                      />
                    </label>
                    <label>
                      סיום החלק לשיבוץ
                      <input
                        type="datetime-local"
                        dir="ltr"
                        value={segmentEnd}
                        onChange={(e) => setSegmentEnd(e.target.value)}
                      />
                    </label>
                  </div>
                  <p className="form-help muted">
                    העובדים למטה נבדקים לפי החלק שבחרתם. השיבוצים הקיימים נשמרים.
                  </p>
                  {!segmentValid && (
                    <div className="notice warning">
                      בחרו טווח תקין בתוך המשמרת. במעבר שעון קיץ בחרו שעות שאינן
                      חסרות או כפולות.
                    </div>
                  )}
                </div>
              )}
            </>
            <div className="candidate-toolbar">
              <div className="search-field">
                <Search size={16} />
                <input
                  placeholder="חיפוש עובד לשיבוץ"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                />
                הצגת לא זמינים
              </label>
            </div>
            <div className="candidate-list">
              {candidates
                .filter(
                  (c) =>
                    (showAll || c.eligible) && c.employee.name.includes(query),
                )
                .map((c) => (
                  <button
                    key={c.employee.id}
                    className={`candidate ${!c.eligible ? "unavailable" : ""}`}
                    onClick={() => assign(c.employee.id)}
                    disabled={!c.eligible}
                  >
                    <span className="avatar small">
                      {c.employee.name.charAt(0)}
                    </span>
                    <span>
                      <strong>{c.employee.name}</strong>
                      <small>
                        {c.eligible
                          ? `${Math.round(c.hours * 10) / 10} שעות משובצות השבוע`
                          : c.reasons.join(" · ")}
                      </small>
                    </span>
                    {c.eligible ? (
                      <Plus size={16} />
                    ) : (
                      <AlertTriangle size={16} />
                    )}
                  </button>
                ))}
              {candidates.filter(
                (c) => (showAll || c.eligible) && c.employee.name.includes(query),
              ).length === 0 && (
                <p className="empty-label">אין עובדים נוספים שמתאימים לבחירה.</p>
              )}
            </div>
          </section>
        </details>
        <details className="shift-disclosure shift-note">
          <summary><strong>הערה ניהולית</strong><small>{draft.note ? "קיימת הערה · הצגה ועריכה" : "הוספת הערה (רשות)"}</small></summary>
          <label className="shift-disclosure-body">
            הערה ניהולית <span className="muted">(למנהל בלבד)</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={draft.note || ""}
              placeholder="מידע שימושי לקראת המשמרת…"
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </details>
        {issues.length > 0 && (
          <div className="validation-list">
            {issues.map((i, index) => (
              <div
                className={`notice ${i.severity === "error" ? "error" : "warning"}`}
                key={index}
              >
                <AlertTriangle size={16} />
                <span>
                  {i.employeeId && <strong>{data.employees.find((e) => e.id === i.employeeId)?.name || "עובד לא מזוהה"}: </strong>}
                  {i.message}
                </span>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}

      </div>
      <div className="dialog-footer">
        <div className="button-row">
          {!isNew && (
            <>
              <button
                className="button secondary danger"
                aria-label="מחיקת משמרת"
                disabled={busy}
                onClick={() => {
                  setDeleteError("");
                  setDeleting(true);
                }}
              >
                <Trash2 size={18} />
                מחיקה
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => save(true)}
              >
                <Copy size={16} />
                שכפול
              </button>
            </>
          )}
        </div>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            ביטול
          </button>
          <button
            className="button primary"
            disabled={busy || !draft.title.trim()}
            onClick={() => save()}
          >
            <Check size={17} />
            {busy ? "שומר…" : "שמירת משמרת"}
          </button>
        </div>
      </div>
      {deleting && (
        <Modal
          open
          onClose={() => !busy && setDeleting(false)}
          title="למחוק את המשמרת?"
          description={`המשמרת ״${shift.title}״ וכל שיבוצי העובדים שלה יימחקו מהטיוטה. אפשר לשחזר באמצעות ״ביטול שינוי אחרון״ בלוח.`}
        >
          <div className="editor-body">
            <div className="notice warning">
              <AlertTriangle size={20} aria-hidden="true" />
              <span>
                <strong>{shift.title}</strong>
                <br />
                {localDate(shift.start)} · <span dir="ltr">{localTime(shift.start)}–{localTime(shift.end)}</span>
                <br />
                יוסרו גם {shift.assignments.length} שיבוצי עובדים.
              </span>
            </div>
            {deleteError && <div className="notice error" role="alert">{deleteError}</div>}
          </div>
          <div className="dialog-footer">
            <button
              className="button secondary"
              autoFocus
              disabled={busy}
              onClick={() => setDeleting(false)}
            >
              חזרה לעריכה
            </button>
            <button
              className="button delete-confirm"
              disabled={busy}
              onClick={async () => {
                setDeleteError("");
                try {
                  await onDelete(shift.id);
                } catch (e) {
                  setDeleteError((e as Error).message);
                }
              }}
            >
              <Trash2 size={17} aria-hidden="true" />
              {busy ? "מוחק…" : "כן, מחיקת המשמרת"}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
