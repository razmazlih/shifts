"use client";

import { useRef, useState } from "react";
import { Copy, Plus, Trash2, Layers, LoaderCircle } from "lucide-react";
import { GROUP_LABELS, type Group, type Template, type TemplateEntry } from "@/lib/types";
import { api } from "@/lib/utils";
import { templateToEntries } from "@/lib/template-definitions";
import "./template-builder.css";

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
type Entry = TemplateEntry & { key: string };
const initialEntry = (): Entry => ({ key: "first", title: "משמרת בוקר", group: "MANAGERS", startTime: "07:00", endTime: "15:00", required: 1, days: [...ALL_DAYS] });

export function TemplateBuilder({ weekStart, onCreated, template, onSavingChange, disabled = false }: {
  weekStart: string;
  onCreated: (template: Template) => void;
  template?: Template;
  onSavingChange?: (saving: boolean) => void;
  disabled?: boolean;
}) {
  const pending = useRef(false);
  const [initial] = useState(() => {
    try { return { entries: template ? templateToEntries(template).map((entry, index) => ({ ...entry, key: `existing-${index}` })) : [initialEntry()], error: "" }; }
    catch (cause) { return { entries: [] as Entry[], error: (cause as Error).message }; }
  });
  const [name, setName] = useState(template?.name ?? "");
  const [entries, setEntries] = useState<Entry[]>(initial.entries);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(initial.error);
  const count = entries.reduce((sum, entry) => sum + entry.days.length, 0);
  const invalid = !name.trim() || !count || count > 300 || entries.some((entry) => !entry.title.trim() || !entry.days.length || !entry.startTime || !entry.endTime || !Number.isInteger(entry.required) || entry.required < 1 || entry.required > 50 || entry.endDayOffset === 0 && entry.endTime <= entry.startTime || entry.endDayOffset === 2 && entry.endTime > entry.startTime);
  const locked = disabled || saving;
  function update(key: string, patch: Partial<TemplateEntry>) {
    setEntries((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  }
  return (
    <form className="template-builder" onSubmit={async (event) => {
      event.preventDefault();
      if (locked || invalid || pending.current) return;
      pending.current = true;
      setSaving(true);
      onSavingChange?.(true);
      setError("");
      try {
        const { template: savedTemplate } = await api<{ template: Template }>("/api/templates", template ? "PATCH" : "POST", {
          name: name.trim(), ...(template ? { templateId: template.id, revision: template.revision ?? 0 } : { weekStart }),
          entries: entries.map(({ title, group, startTime, endTime, endDayOffset, required, days }) => ({ title: title.trim(), group, startTime, endTime, ...(endDayOffset === undefined ? {} : { endDayOffset }), required, days })),
        });
        setName("");
        setEntries([initialEntry()]);
        onCreated(savedTemplate);
      } catch (cause) {
        setError(`לא נשמר. ${(cause as Error).message}`);
      } finally {
        pending.current = false;
        setSaving(false);
        onSavingChange?.(false);
      }
    }}>
      <div className="template-builder-intro">
        <span className="template-builder-icon"><Layers size={20} /></span>
        <div><h3>{template ? "עריכת תבנית קיימת" : "תבנית חדשה, בלי לבנות שבוע ידנית"}</h3><p>{template ? "השינוי ישפיע על הכנת שבועות בעתיד בלבד. שבועות קיימים והפרסומים שלהם לא ישתנו." : "מגדירים שעות, צוות וימים. אחר כך השיבוץ החכם יציע עובדים."}</p></div>
      </div>
      <label className="template-builder-name">שם לתבנית
        <input required maxLength={100} value={name} disabled={locked} onChange={(event) => setName(event.target.value)} placeholder="למשל, שבוע רגיל עם בוקר ולילה" />
      </label>
      <fieldset disabled={locked} className="template-builder-entries">
        <legend className="sr-only">המשמרות בתבנית</legend>
        {entries.map((entry, index) => (
          <div className="template-builder-entry" key={entry.key}>
            <div className="template-builder-entry-heading"><strong>משמרת {index + 1}</strong><div>
              <button type="button" className="icon-button" aria-label={`שכפול משמרת ${index + 1}`} disabled={entries.length >= 300} onClick={() => setEntries((current) => [...current, { ...entry, key: crypto.randomUUID(), days: [...entry.days] }])}><Copy size={16} /></button>
              <button type="button" className="icon-button" aria-label={`הסרת משמרת ${index + 1}`} disabled={entries.length === 1} onClick={() => setEntries((current) => current.filter((item) => item.key !== entry.key))}><Trash2 size={16} /></button>
            </div></div>
            <div className="template-builder-fields">
              <label className="template-builder-title">שם המשמרת<input required maxLength={120} value={entry.title} onChange={(event) => update(entry.key, { title: event.target.value })} /></label>
              <label>צוות<select value={entry.group} onChange={(event) => update(entry.key, { group: event.target.value as Group })}>{Object.entries(GROUP_LABELS).map(([group, label]) => <option key={group} value={group}>{label}</option>)}</select></label>
              <label>התחלה<input required type="time" value={entry.startTime} onChange={(event) => update(entry.key, { startTime: event.target.value })} /></label>
              <label>סיום<input required type="time" value={entry.endTime} onChange={(event) => update(entry.key, { endTime: event.target.value })} /></label>
              <label>יום הסיום<select value={entry.endDayOffset ?? "auto"} onChange={event => update(entry.key, { endDayOffset: event.target.value === "auto" ? undefined : Number(event.target.value) })}><option value="auto">לפי השעות</option><option value="0">באותו יום</option><option value="1">ביום הבא</option><option value="2">כעבור יומיים</option></select></label>
              <label>כמה עובדים?<input required type="number" min={1} max={50} value={entry.required || ""} onChange={(event) => update(entry.key, { required: Number(event.target.value) })} /></label>
            </div>
            {(entry.endDayOffset ?? (entry.endTime <= entry.startTime ? 1 : 0)) > 0 && <p className="template-builder-overnight">{entry.endDayOffset === 2 ? "המשמרת מסתיימת כעבור יומיים (עד 48 שעות)." : "המשמרת מסתיימת ביום הבא."}</p>}
            <div className="template-builder-days-heading"><span>באילו ימים?</span><div><button type="button" onClick={() => update(entry.key, { days: [...ALL_DAYS] })}>כל השבוע</button><button type="button" onClick={() => update(entry.key, { days: [0, 1, 2, 3, 4] })}>ראשון–חמישי</button></div></div>
            <div className="template-builder-days" role="group" aria-label={`ימים למשמרת ${index + 1}`}>
              {DAYS.map((day, dayIndex) => <button type="button" key={day} aria-pressed={entry.days.includes(dayIndex)} onClick={() => update(entry.key, { days: entry.days.includes(dayIndex) ? entry.days.filter((item) => item !== dayIndex) : [...entry.days, dayIndex].sort() })}>{day}</button>)}
            </div>
            {!entry.days.length && <p className="template-builder-day-error">בחרו לפחות יום אחד למשמרת הזו.</p>}
          </div>
        ))}
      </fieldset>
      <button type="button" className="button secondary template-builder-add" disabled={locked || entries.length >= 300} onClick={() => setEntries((current) => [...current, { ...initialEntry(), key: crypto.randomUUID(), title: "משמרת נוספת" }])}><Plus size={17} />הוספת משמרת לתבנית</button>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="template-builder-footer"><p>{count} משמרות בשבוע<span>התבנית נשמרת לשימוש חוזר, ללא שמות עובדים.</span>{count > 300 && <span className="template-builder-day-error">אפשר לשמור עד 300 משמרות.</span>}</p><button type="submit" className="button primary" disabled={locked || invalid}>{saving ? <LoaderCircle className="spin" size={17} /> : <Layers size={17} />}{saving ? "שומר תבנית…" : template ? "שמירת השינויים בתבנית" : "שמירת תבנית חדשה"}</button></div>
    </form>
  );
}
