"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode } from "react";
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(value) => !value && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className={`dialog-content ${wide ? "dialog-wide" : ""}`}
          dir="rtl"
        >
          <div className="dialog-heading">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description>
                {description || "עדכנו את הפרטים ושמרו את השינויים."}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="icon-button" aria-label="סגירה">
              <X size={20} />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
