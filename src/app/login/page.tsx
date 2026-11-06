"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  CalendarDays,
  ArrowLeft,
  ShieldCheck,
  LoaderCircle,
  Check,
} from "lucide-react";
import { api } from "@/lib/utils";
import { Button } from "@/components/ui/button";
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", "POST", { email, password });
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <CalendarDays />
          </span>
          <span>
            משמרת<span className="brand-caption">הצוות שלכם, מסודר.</span>
          </span>
        </Link>
        <div className="login-story-content">
          <span className="eyebrow">קצת סדר. הרבה שקט.</span>
          <h1>
            שבוע חדש.
            <br />
            כולם במקום הנכון.
          </h1>
          <p>
            כל המשמרות, האנשים והשינויים.
            <br />
            במקום אחד שנעים לפתוח.
          </p>
          <div className="login-preview">
            <div className="preview-top">
              <span>השבוע של הצוות</span>
              <span className="tag green">פורסם לצוות</span>
            </div>
            {["יום ראשון", "יום שני", "יום שלישי"].map((d, i) => (
              <div className="preview-row" key={d}>
                <span>{d}</span>
                <div
                  className={i === 1 ? "preview-shift purple" : "preview-shift"}
                >
                  <span>משמרת בוקר</span>
                  <small>07:00 — 15:00</small>
                  <Check size={15} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <small>פחות תיאומים. יותר עבודת צוות.</small>
      </section>
      <section className="login-form-wrap">
        <form onSubmit={submit} className="login-form">
          <span className="login-symbol">
            <CalendarDays size={28} />
          </span>
          <h2>טוב לראות אתכם</h2>
          <p className="muted">נכנסים ומתכננים את השבוע הבא.</p>
          <label>
            כתובת אימייל
            <input
              type="email"
              autoComplete="username"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.co.il"
              required
            />
          </label>
          <label>
            סיסמה
            <input
              type="password"
              autoComplete="current-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="הסיסמה שלכם"
              required
              minLength={8}
            />
          </label>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <Button className="button primary login-submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                כניסה למערכת
                <ArrowLeft size={18} />
              </>
            )}
          </Button>
          <div className="login-security">
            <ShieldCheck size={15} />
            הגישה ללוח מותאמת להרשאות שלכם
          </div>
          <details className="demo-access">
            <summary>כניסה לחשבונות הדגמה</summary>
            <p>זמינים רק בסביבה שבה הותקנו נתוני ההדגמה.</p>
            <div className="button-row">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setEmail("admin@demo.local");
                  setPassword("DemoAdmin!2026");
                }}
              >
                מנהל הדגמה
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setEmail("employee@demo.local");
                  setPassword("DemoWorker!2026");
                }}
              >
                עובד הדגמה
              </button>
            </div>
          </details>
        </form>
        <footer>משמרת · ניהול צוות, בנחת</footer>
      </section>
    </main>
  );
}
