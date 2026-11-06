"use client";
import { useEffect, useRef } from "react";
export function PrintControls({ auto = false }: { auto?: boolean }) {
  const printed = useRef(false);
  useEffect(() => {
    if (auto && !printed.current) {
      printed.current = true;
      void document.fonts.ready.then(() => window.print());
    }
  }, [auto]);
  return (
    <div className="print-controls">
      <button onClick={() => window.print()}>הדפסת הסידור</button>
      <span>בחרו כיוון לרוחב בהגדרות ההדפסה.</span>
    </div>
  );
}
