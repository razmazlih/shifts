"use client";
import { useRef, useState } from "react";
import { Copy, Pencil, Star, Trash2 } from "lucide-react";
import type { Template } from "@/lib/types";
import { api } from "@/lib/utils";

export function TemplateActions({ template, disabled, onUpdated, onDuplicated, onEdit, onApply, onDelete }: { template: Template; disabled: boolean; onUpdated: (template: Template) => void; onDuplicated: (template: Template) => void; onEdit: () => void; onApply: () => void; onDelete: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(template.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  async function mutate(method: "POST" | "PATCH", data: unknown, duplicated = false) {
    if (pendingRef.current || disabled) return;
    pendingRef.current = true; setPending(true); setError("");
    try { const result = await api<{ template: Template }>("/api/templates", method, data); (duplicated ? onDuplicated : onUpdated)(result.template); setRenaming(false); }
    catch (cause) { setError(`לא נשמר. ${(cause as Error).message}`); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <div className="template-management-actions"><details><summary>פעולות נוספות לתבנית</summary><div className="button-row"><button className="button secondary" disabled={disabled || pending} aria-pressed={!!template.favorite} aria-label={`${template.favorite ? "ביטול העדפת" : "סימון כמועדפת"} ${template.name}`} onClick={() => void mutate("PATCH", { templateId: template.id, favorite: !template.favorite })}><Star size={15} fill={template.favorite ? "currentColor" : "none"} />{template.favorite ? "מועדפת שלי" : "מועדפת"}</button><button className="button secondary" disabled={disabled || pending} onClick={() => { setName(template.name); setRenaming(value => !value); }}>שינוי שם</button><button className="button secondary" disabled={disabled || pending} onClick={() => void mutate("POST", { cloneTemplateId: template.id, revision: template.revision ?? 0 }, true)}><Copy size={15} />שכפול</button><button className="button secondary" disabled={disabled || pending} onClick={onEdit}><Pencil size={15} />עריכה</button><button className="button secondary" disabled={disabled || pending} onClick={onApply}>החלת משמרות ללא שיבוץ</button><button className="button secondary danger" disabled={disabled || pending} aria-label={`מחיקת התבנית ${template.name}`} onClick={onDelete}><Trash2 size={15} />מחיקה</button></div>{renaming && <form className="template-rename" onSubmit={event => { event.preventDefault(); void mutate("PATCH", { templateId: template.id, revision: template.revision ?? 0, name }); }}><label>שם חדש לתבנית<input autoFocus value={name} maxLength={100} required disabled={pending} onChange={event => setName(event.target.value)} /></label><button className="button primary" disabled={pending || !name.trim()}>שמירת שם</button></form>}</details>{error && <p className="notice error" role="alert">{error}</p>}</div>;
}
