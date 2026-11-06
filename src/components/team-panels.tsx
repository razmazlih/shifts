"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Users,
  Check,
  Trash2,
  ShieldCheck,
  Clock3,
  SlidersHorizontal,
} from "lucide-react";
import {
  GROUP_LABELS,
  type Employee,
  type Group,
  type Rules,
} from "@/lib/types";
import { addDays, localDate, localTime, localToISO } from "@/lib/time";
import { api } from "@/lib/utils";
import { Modal } from "./ui/dialog";
const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const emptyEmployee = (): Employee => ({
  id: "",
  name: "",
  email: "",
  active: true,
  groups: ["PATROL"],
  maxWeeklyHours: 42,
  availability: [],
  timeOff: [],
  preferredDays: [],
});
export function EmployeesPanel({
  onUpdated,
  defaultMaxHours = 42,
}: {
  onUpdated: () => void;
  defaultMaxHours?: number;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [query, setQuery] = useState("");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    try {
      setEmployees(
        (await api<{ employees: Employee[] }>("/api/employees")).employees,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, []);
  async function save() {
    if (!employee) return;
    if (
      employee.timeOff.some(
        (t) => !t.start || !t.end || Date.parse(t.end) <= Date.parse(t.start),
      )
    ) {
      setError("השלימו תאריכי התחלה וסיום תקינים לכל חופשה.");
      return;
    }
    if (employee.availability.some((a) => a.start === a.end)) {
      setError("שעת ההתחלה והסיום של חלון זמינות חייבות להיות שונות.");
      return;
    }
    if (!employee.id && password && (!employee.email || password.length < 12)) {
      setError("ליצירת חשבון כניסה נדרשים אימייל וסיסמה באורך 12 תווים לפחות.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(
        employee.id ? `/api/employees/${employee.id}` : "/api/employees",
        employee.id ? "PUT" : "POST",
        {
          employee: employee.id
            ? employee
            : {
                name: employee.name,
                email: employee.email,
                active: employee.active,
                groups: employee.groups,
                maxWeeklyHours: employee.maxWeeklyHours,
                availability: employee.availability,
                timeOff: employee.timeOff,
                preferredDays: employee.preferredDays,
              },
          ...(employee.id ? {} : { password: password || undefined }),
        },
      );
      await load();
      setEmployee(null);
      onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">אנשים לפני הכול.</div>
          <h1>
            אנשי הצוות<span className="heading-dot">.</span>
          </h1>
          <p>היכרות קטנה עם הצוות. תכנון הרבה יותר טוב.</p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setEmployee({
              ...emptyEmployee(),
              maxWeeklyHours: defaultMaxHours,
            });
            setPassword("");
            setError("");
          }}
        >
          <Plus size={18} />
          הוספת עובד
        </button>
      </section>
      {error && !employee && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <section className="people-panel">
        <div className="people-toolbar">
          <h2>
            <Users size={20} />
            {employees.length} אנשי צוות
          </h2>
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="חיפוש עובד"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש לפי שם או אימייל…"
            />
          </div>
        </div>
        <div className="people-table">
          <div className="people-table-header">
            <span>חבר צוות</span>
            <span>צוותים</span>
            <span>מכסת שעות שבועית</span>
            <span>סטטוס</span>
            <span />
          </div>
          {employees
            .filter((e) =>
              `${e.name} ${e.email}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((e) => (
              <button
                className="person-table-row"
                key={e.id}
                onClick={() => {
                  setEmployee(structuredClone(e));
                  setPassword("");
                  setError("");
                }}
              >
                <span className="person-identity">
                  <span className="avatar">{e.name.charAt(0)}</span>
                  <span>
                    <strong>{e.name}</strong>
                    <small dir="ltr">{e.email || "ללא חשבון כניסה"}</small>
                  </span>
                </span>
                <span className="button-row">
                  {e.groups.map((g) => (
                    <span
                      className={`tag ${g === "MANAGERS" ? "green" : "purple"}`}
                      key={g}
                    >
                      {GROUP_LABELS[g]}
                    </span>
                  ))}
                </span>
                <span>{e.maxWeeklyHours} שעות</span>
                <span
                  className={`status-pill ${e.active ? "published" : "inactive"}`}
                >
                  <span />
                  {e.active ? "פעיל" : "לא פעיל"}
                </span>
                <span className="text-button">עריכה</span>
              </button>
            ))}
        </div>
        {loading && <p className="empty-label">טוען את הצוות…</p>}
        {!loading && employees.length === 0 && (
          <p className="empty-label">
            הוסיפו את חבר הצוות הראשון כדי להתחיל לשבץ.
          </p>
        )}
      </section>
      {employee && (
        <Modal
          open
          onClose={() => !busy && setEmployee(null)}
          title={employee.id ? "עריכת פרטי עובד" : "חבר צוות חדש"}
          description="הגדירו צוותים וזמינות כדי שהשיבוץ יתאים גם לאנשים."
          wide
        >
          <div className="editor-body">
            <div className="form-grid">
              <label>
                שם מלא
                <input
                  value={employee.name}
                  onChange={(e) =>
                    setEmployee({ ...employee, name: e.target.value })
                  }
                  maxLength={100}
                />
              </label>
              <label>
                כתובת אימייל
                <input
                  type="email"
                  dir="ltr"
                  value={employee.email || ""}
                  onChange={(e) =>
                    setEmployee({ ...employee, email: e.target.value })
                  }
                />
              </label>
              <label>
                מקסימום שעות בשבוע
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={employee.maxWeeklyHours}
                  onChange={(e) =>
                    setEmployee({
                      ...employee,
                      maxWeeklyHours: Number(e.target.value),
                    })
                  }
                />
              </label>
              {!employee.id && (
                <label>
                  סיסמה לחשבון העובד
                  <input
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="לפחות 12 תווים, אות ומספר"
                  />
                  <small>
                    הזנת אימייל וסיסמה תאפשר לעובד להיכנס ללוח. מסרו לו אותם
                    באופן פרטי.
                  </small>
                </label>
              )}
            </div>
            <div className="form-section">
              <h3>שיוך לצוותים</h3>
              <div className="button-row">
                {Object.entries(GROUP_LABELS).map(([g, label]) => (
                  <label className="check-label check-tile" key={g}>
                    <input
                      type="checkbox"
                      checked={employee.groups.includes(g as Group)}
                      onChange={(e) =>
                        setEmployee({
                          ...employee,
                          groups: e.target.checked
                            ? [...employee.groups, g as Group]
                            : employee.groups.filter((x) => x !== g),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-section">
              <div className="section-line">
                <h3>זמינות שבועית</h3>
                <button
                  className="text-button"
                  onClick={() =>
                    setEmployee({
                      ...employee,
                      availability: [
                        ...employee.availability,
                        { day: 0, start: "07:00", end: "23:00" },
                      ],
                    })
                  }
                >
                  <Plus size={15} />
                  חלון זמינות
                </button>
              </div>
              <p className="muted form-help">
                ללא חלונות מוגדרים: זמין בכל ימי השבוע. עם חלונות: רק בטווחים
                שהוגדרו. שעת סיום מוקדמת מההתחלה מגדירה זמינות עד היום הבא.
              </p>
              {employee.availability.map((a, i) => (
                <div className="availability-row" key={i}>
                  <select
                    aria-label="יום בשבוע"
                    value={a.day}
                    onChange={(e) =>
                      setEmployee({
                        ...employee,
                        availability: employee.availability.map((x, j) =>
                          j === i ? { ...x, day: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  >
                    {days.map((d, n) => (
                      <option value={n} key={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="זמין מהשעה"
                    type="time"
                    value={a.start}
                    onChange={(e) =>
                      setEmployee({
                        ...employee,
                        availability: employee.availability.map((x, j) =>
                          j === i ? { ...x, start: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <span>עד</span>
                  <input
                    aria-label="זמין עד השעה"
                    type="time"
                    value={a.end}
                    onChange={(e) =>
                      setEmployee({
                        ...employee,
                        availability: employee.availability.map((x, j) =>
                          j === i ? { ...x, end: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    className="icon-button danger"
                    aria-label="מחיקת חלון זמינות"
                    onClick={() =>
                      setEmployee({
                        ...employee,
                        availability: employee.availability.filter(
                          (_, j) => j !== i,
                        ),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="form-section">
              <h3>ימים מועדפים</h3>
              <p className="muted form-help">
                העדפה לשיבוץ החכם, ללא חסימה בימים אחרים.
              </p>
              <div className="day-preferences">
                {days.map((d, i) => (
                  <button
                    key={d}
                    className={
                      employee.preferredDays.includes(i) ? "selected" : ""
                    }
                    onClick={() =>
                      setEmployee({
                        ...employee,
                        preferredDays: employee.preferredDays.includes(i)
                          ? employee.preferredDays.filter((x) => x !== i)
                          : [...employee.preferredDays, i],
                      })
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-section">
              <div className="section-line">
                <h3>חופשות ואילוצים</h3>
                <button
                  className="text-button"
                  onClick={() =>
                    setEmployee({
                      ...employee,
                      timeOff: [
                        ...employee.timeOff,
                        { start: "", end: "", reason: "" },
                      ],
                    })
                  }
                >
                  <Plus size={15} />
                  הוספת חופשה
                </button>
              </div>
              {employee.timeOff.map((t, i) => t.requestId ? (
                <div className="notice" key={t.requestId}>
                  <div><strong>אילוץ מבקשה שאושרה — מנוהל דרך בקשות העובדים</strong>
                    <p><bdi dir="ltr">{localDate(t.start)} {localTime(t.start)} — {localDate(t.end)} {localTime(t.end)}</bdi></p>
                    {t.reason && <p>{t.reason}</p>}
                    <small>לביטול האילוץ, פתחו את הבקשה ובחרו ״ביטול האישור״.</small>
                  </div>
                </div>
              ) : (
                <div className="timeoff-row" key={i}>
                  <label>
                    מתאריך
                    <input
                      type="date"
                      value={t.start ? localDate(t.start) : ""}
                      onChange={(e) =>
                        setEmployee({
                          ...employee,
                          timeOff: employee.timeOff.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  start: e.target.value
                                    ? localToISO(e.target.value, "00:00")
                                    : "",
                                }
                              : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    עד תאריך (כולל)
                    <input
                      type="date"
                      value={t.end ? addDays(localDate(t.end), -1) : ""}
                      onChange={(e) =>
                        setEmployee({
                          ...employee,
                          timeOff: employee.timeOff.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  end: e.target.value
                                    ? localToISO(
                                        addDays(e.target.value, 1),
                                        "00:00",
                                      )
                                    : "",
                                }
                              : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    סיבה
                    <input
                      value={t.reason || ""}
                      onChange={(e) =>
                        setEmployee({
                          ...employee,
                          timeOff: employee.timeOff.map((x, j) =>
                            j === i ? { ...x, reason: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    className="icon-button danger"
                    aria-label="מחיקת חופשה"
                    onClick={() =>
                      setEmployee({
                        ...employee,
                        timeOff: employee.timeOff.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={employee.active}
                onChange={(e) =>
                  setEmployee({ ...employee, active: e.target.checked })
                }
              />
              עובד פעיל — ניתן לשבץ למשמרות חדשות
            </label>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="dialog-footer">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setEmployee(null)}
            >
              ביטול
            </button>
            <button
              className="button primary"
              disabled={
                busy || !employee.name.trim() || employee.groups.length === 0
              }
              onClick={save}
            >
              <Check size={17} />
              {busy ? "שומר…" : "שמירת פרטים"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function SettingsPanel({
  initialRules,
  onUpdated,
}: {
  initialRules: Rules;
  onUpdated: () => void;
}) {
  const [rules, setRules] = useState(initialRules);
  const [expectedRules, setExpectedRules] = useState(initialRules);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/settings", "PUT", { rules, expectedRules });
      setExpectedRules(rules);
      setMessage("הגדרות השיבוץ נשמרו. הלוח נבדק מחדש לפי הכללים המעודכנים.");
      onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">הכללים שעושים סדר.</div>
          <h1>
            הגדרות שיבוץ<span className="heading-dot">.</span>
          </h1>
          <p>מגדירים גבולות ברורים, ובונים שבוע מאוזן.</p>
        </div>
      </section>
      <section className="settings-panel">
        <div className="settings-intro">
          <span className="stat-icon teal">
            <SlidersHorizontal size={23} />
          </span>
          <div>
            <h2>כללי תכנון לצוות</h2>
            <p>הכללים נבדקים בכל שמירה ובכל הצעת שיבוץ אוטומטי.</p>
          </div>
        </div>
        <label className="setting-row">
          <span>
            <strong>
              <Clock3 size={18} />
              מנוחה בין משמרות
            </strong>
            <small>מספר השעות המינימלי בין סיום משמרת לתחילת הבאה.</small>
          </span>
          <div>
            <input
              type="number"
              min={0}
              max={48}
              value={rules.minRestHours}
              onChange={(e) =>
                setRules({ ...rules, minRestHours: Number(e.target.value) })
              }
            />
            <span>שעות</span>
          </div>
        </label>
        <label className="setting-row">
          <span>
            <strong>אורך שיבוץ מרבי</strong>
            <small>
              מספר השעות המותר לעובד ברצף. ניתן לפצל משמרת בין עובדים.
            </small>
          </span>
          <div>
            <input
              type="number"
              min={1}
              max={24}
              value={rules.maxShiftHours}
              onChange={(e) =>
                setRules({ ...rules, maxShiftHours: Number(e.target.value) })
              }
            />
            <span>שעות</span>
          </div>
        </label>
        <label className="setting-row">
          <span>
            <strong>מכסת שעות שבועית כברירת מחדל</strong>
            <small>
              ברירת מחדל לעובדים חדשים. מכסות אישיות של עובדים קיימים נשארות ללא
              שינוי.
            </small>
          </span>
          <div>
            <input
              type="number"
              min={1}
              max={168}
              value={rules.defaultMaxWeeklyHours}
              onChange={(e) =>
                setRules({
                  ...rules,
                  defaultMaxWeeklyHours: Number(e.target.value),
                })
              }
            />
            <span>שעות</span>
          </div>
        </label>
        <div className="notice">
          <ShieldCheck size={18} />
          מגבלות ארגוניות לתכנון. הגדירו אותן בהתאם להסכמים ולנהלים של הצוות
          שלכם.
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="notice success" role="status">
            {message}
          </div>
        )}
        <div className="settings-footer">
          <button className="button primary" disabled={busy} onClick={save}>
            <Check size={17} />
            {busy ? "שומר…" : "שמירת הגדרות"}
          </button>
        </div>
      </section>
    </>
  );
}
