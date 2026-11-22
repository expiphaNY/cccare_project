// =============================================================================
// layout.tsx : THE ROOT OF EVERY PAGE
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The outermost page shell: the page title, an instruction to search engines not to index the site
//   (it holds health data), the theme colour and the development-only banner that warns when the
//   database is configured but unreachable.
// =============================================================================

import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { StoreWarning } from "@/components/StoreWarning";
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
      <body className="min-h-full flex flex-col text-ink">
        <Suspense fallback={null}>
          <StoreWarning />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
