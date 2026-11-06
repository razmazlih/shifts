"use client";
import { useState } from "react";
import { Minus, Plus, Moon, Sun, Sunset, Clock3 } from "lucide-react";
import {
  addDays,
  localDate,
  localTime,
  localToISO,
  weekDates,
} from "@/lib/time";
import { GROUP_LABELS, type Shift, type Group } from "@/lib/types";

const presets = [
  { title: "משמרת בוקר", start: "07:00", end: "15:00", icon: Sun },
  { title: "משמרת ערב", start: "15:00", end: "23:00", icon: Sunset },
  { title: "משמרת לילה", start: "22:00", end: "06:00", icon: Moon },
];
const dayDifference = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const minutes = (clock: string) =>
  Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
function wallEnd(date: string, time: string, length: number) {
  const total = minutes(time) + length;
  return localToISO(
    addDays(date, Math.floor(total / 1440)),
    `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
  );
}
function DayTime({
  kind,
  value,
  week,
  onChange,
}: {
  kind: "start" | "end";
  value: string;
  week: string;
  onChange: (date: string, time: string, dayChanged: boolean) => void;
}) {
  const date = localDate(value),
    time = localTime(value);
  const dates = [
    ...new Set([
      ...weekDates(week),
      ...(kind === "end" ? [addDays(week, 7), addDays(week, 8)] : []),
      date,
    ]),
  ].sort();
  const start = kind === "start";
  return (
    <fieldset className="touch-moment">
      <legend>{start ? "תחילת המשמרת" : "סיום המשמרת"}</legend>
      <label className="touch-day-label">
        <span>יום</span>
        <select
          aria-label={start ? "יום תחילת המשמרת" : "יום סיום המשמרת"}
          value={date}
          onChange={(e) => onChange(e.target.value, time, true)}
        >
          {dates.map((d) => (
            <option value={d} key={d}>
              {new Intl.DateTimeFormat("he-IL", {
                weekday: "long",
                day: "numeric",
                month: "numeric",
                timeZone: "Asia/Jerusalem",
              }).format(new Date(d + "T12:00:00Z"))}
            </option>
          ))}
        </select>
      </label>
      <div className="touch-clock" dir="ltr">
        <label>
          <span>שעה</span>
          <select
            aria-label={start ? "שעת התחלה" : "שעת סיום"}
            value={time.slice(0, 2)}
            onChange={(e) =>
              onChange(date, e.target.value + time.slice(2), false)
            }
          >
            {Array.from({ length: 24 }, (_, i) =>
              String(i).padStart(2, "0"),
            ).map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <span className="clock-colon">:</span>
        <label>
          <span>דקות</span>
          <select
            aria-label={start ? "דקות התחלה" : "דקות סיום"}
            value={time.slice(3, 5)}
            onChange={(e) =>
              onChange(date, time.slice(0, 3) + e.target.value, false)
            }
          >
            {Array.from({ length: 60 }, (_, i) =>
              String(i).padStart(2, "0"),
            ).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
export function ShiftFields({
  draft,
  week,
  onChange,
}: {
  draft: Shift;
  week: string;
  onChange: (next: Shift) => void;
}) {
  const [error, setError] = useState("");
  const duration =
    dayDifference(localDate(draft.start), localDate(draft.end)) * 1440 +
    minutes(localTime(draft.end)) -
    minutes(localTime(draft.start));
  function update(fn: () => Shift) {
    try {
      const next = fn();
      if (Date.parse(next.end) <= Date.parse(next.start))
        throw Error(
          "סיום המשמרת צריך להיות אחרי ההתחלה. בחרו את יום הסיום המתאים.",
        );
      if (Date.parse(next.end) - Date.parse(next.start) > 48 * 3600000)
        throw Error("אפשר ליצור משמרת באורך של עד 48 שעות.");
      onChange(next);
      setError("");
    } catch (e) {
      setError(
        e instanceof RangeError
          ? "השעה שבחרתם חסרה או כפולה במעבר שעון. בחרו שעה חד־משמעית אחרת."
          : (e as Error).message,
      );
    }
  }
  function setMoment(
    kind: "start" | "end",
    date: string,
    time: string,
    dayChanged: boolean,
  ) {
    update(() => {
      if (kind === "start")
        return {
          ...draft,
          start: localToISO(date, time),
          end: wallEnd(date, time, duration),
        };
      let end = localToISO(date, time);
      if (
        !dayChanged &&
        date === localDate(draft.start) &&
        Date.parse(end) <= Date.parse(draft.start)
      )
        end = localToISO(addDays(date, 1), time);
      return { ...draft, end };
    });
  }
  const overnight = dayDifference(localDate(draft.start), localDate(draft.end));
  return (
    <section className="shift-touch-fields" aria-label="בחירת פרטי המשמרת">
      <label className="shift-day">
        יום המשמרת
        <select
          aria-label="יום המשמרת"
          value={localDate(draft.start)}
          onChange={(e) => setMoment("start", e.target.value, localTime(draft.start), true)}
        >
          {[...new Set([...weekDates(week), localDate(draft.start)])].sort().map((date) => (
            <option key={date} value={date}>
              {new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date(date + "T12:00:00Z"))}
            </option>
          ))}
        </select>
      </label>
      <div className="shift-presets">
        {presets.map((p) => (
          <button
            type="button"
            key={p.title}
            aria-label={p.title}
            aria-pressed={
              draft.title === p.title &&
              localTime(draft.start) === p.start &&
              localTime(draft.end) === p.end
            }
            onClick={() =>
              update(() => ({
                ...draft,
                title: p.title,
                start: localToISO(localDate(draft.start), p.start),
                end: localToISO(
                  addDays(localDate(draft.start), p.end <= p.start ? 1 : 0),
                  p.end,
                ),
              }))
            }
          >
            <p.icon size={19} />
            <strong>{p.title.replace("משמרת ", "")}</strong>
            <small dir="ltr">
              {p.start}–{p.end}
            </small>
            <span className="sr-only">{p.title}</span>
          </button>
        ))}
      </div>
      <fieldset className="touch-team">
        <legend>צוות</legend>
        <div className="touch-group-buttons">
          {(Object.keys(GROUP_LABELS) as Group[]).map((g) => (
            <button
              type="button"
              key={g}
              aria-pressed={draft.group === g}
              onClick={() => onChange({ ...draft, group: g })}
            >
              {GROUP_LABELS[g]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="touch-required">
        <div>
          <strong>מספר עובדים נדרש</strong>
        </div>
        <div className="required-stepper">
          <button
            type="button"
            aria-label="הפחתת עובד נדרש"
            disabled={draft.required <= 1}
            onClick={() => onChange({ ...draft, required: draft.required - 1 })}
          >
            <Minus size={19} />
          </button>
          <output aria-label="מספר עובדים נדרש" aria-live="polite">
            {draft.required}
          </output>
          <button
            type="button"
            aria-label="הוספת עובד נדרש"
            disabled={draft.required >= 50}
            onClick={() => onChange({ ...draft, required: draft.required + 1 })}
          >
            <Plus size={19} />
          </button>
        </div>
      </div>
      <details className="shift-disclosure shift-hours">
        <summary>
          <span><Clock3 size={16} /><strong>{draft.title || "שם המשמרת"}</strong></span>
          <span className="shift-hours-summary">
            <bdi>{localTime(draft.start)}–{localTime(draft.end)}</bdi>
            {overnight > 0 && <small>{overnight === 1 ? "מסתיימת ביום הבא" : `סיום בעוד ${overnight} ימים`}</small>}
            <small className="disclosure-action">התאמת שעות ושם</small>
          </span>
        </summary>
        <div className="shift-disclosure-body">
          <label>
            שם המשמרת
            <input value={draft.title} maxLength={100} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
          </label>
          <div className="touch-moments">
            <DayTime
              kind="start"
              value={draft.start}
              week={week}
              onChange={(d, t, c) => setMoment("start", d, t, c)}
            />
            <DayTime
              kind="end"
              value={draft.end}
              week={week}
              onChange={(d, t, c) => setMoment("end", d, t, c)}
            />
          </div>
          <div className="touch-duration">
            <span className="touch-label">משך מהיר</span>
            <div>
              {[4, 6, 8, 10, 12].map((h) => (
                <button
                  type="button"
                  key={h}
                  aria-pressed={duration === h * 60}
                  onClick={() =>
                    update(() => ({
                      ...draft,
                      end: wallEnd(
                        localDate(draft.start),
                        localTime(draft.start),
                        h * 60,
                      ),
                    }))
                  }
                >
                  {h} שעות
                </button>
              ))}
            </div>
            <p>
              <Clock3 size={14} />
              {overnight > 0 ? (
                <span>
                  {overnight === 1
                    ? "מסתיימת ביום הבא"
                    : "מסתיימת בעוד " + overnight + " ימים"}{" "}
                  ·{" "}
                </span>
              ) : null}
              {Math.round(
                (Date.parse(draft.end) - Date.parse(draft.start)) / 360000,
              ) / 10}{" "}
              שעות בפועל · שעון ישראל
            </p>
          </div>
        </div>
      </details>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
    </section>
  );
}
