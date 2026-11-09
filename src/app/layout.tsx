import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MyoCare", template: "%s · MyoCare" },
  description: "Muscle activity (EMG) dashboard for patients and clinicians — clear progress, transparent data handling.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col text-ink">{children}</body>
    </html>
  );
}
