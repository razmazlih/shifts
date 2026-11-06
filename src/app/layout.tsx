import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "משמרת — הצוות שלכם, מסודר",
  description: "לוח משמרות שבועי חכם לצוותי אחמ״שים וסיורים",
  applicationName: "משמרת",
  appleWebApp: { capable: true, title: "משמרת", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon-180.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#123a40",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
