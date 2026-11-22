// =============================================================================
// nav.tsx : NAVIGATION BARS AND THE LOGO
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The top bar for clinicians, the plainer bar for people opening a share link, and the tab row inside a patient's record.
// =============================================================================

"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Activity } from "lucide-react";
import { cx } from "./ui";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg pr-2" aria-label="MyoCare home">
      <span className="inline-flex size-8 items-center justify-center rounded-[10px] bg-brand text-white shadow-sm">
        <Activity className="size-[18px]" strokeWidth={2.4} aria-hidden />
      </span>
      <span className="title text-[17px] font-semibold tracking-tight">MyoCare</span>
    </Link>
  );
}

function HeaderShell({ children, role }: { children: ReactNode; role: "clinician" | "shared" }) {
  const label = { clinician: "Clinician view", shared: "Shared record · read-only" }[role];
  return (
    <header className="material no-print sticky top-0 z-40 border-b border-line/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        {children}
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cx(
              "hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex",
              role === "shared" ? "bg-warn-soft text-warn" : "bg-brand-soft text-brand-strong",
            )}
          >
            {label}
          </span>
        </div>
      </div>
    </header>
  );
}

function NavLinks({ items, exact }: { items: { href: string; label: string; except?: string[] }[]; exact?: string[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((it) => {
        const base = exact?.includes(it.href) ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");
        const active = base && !it.except?.some((x) => pathname === x || pathname.startsWith(x + "/"));
        return <NavItem key={it.href} href={it.href} label={it.label} active={active} />;
      })}
    </>
  );
}

function NavItem({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "pressable inline-flex min-h-9 items-center rounded-full px-3 text-[14px] font-medium",
        active ? "bg-ink text-white" : "text-ink-2 hover:bg-brand-soft hover:text-brand",
      )}
    >
      {label}
    </Link>
  );
}

export function ClinicianHeader() {
  const items = [
    { href: "/doctor", label: "Patients", except: ["/doctor/suggestions", "/doctor/settings"] },
    { href: "/doctor/suggestions", label: "Drafts" },
    { href: "/doctor/settings", label: "Weights" },
    { href: "/data-handling", label: "Data handling" },
  ];
  return (
    <HeaderShell role="clinician">
      <Logo href="/doctor" />
      <nav aria-label="Primary" className="ml-2 flex items-center gap-1">
        <Suspense fallback={items.map((it) => <NavItem key={it.href} {...it} />)}>
          <NavLinks items={items} />
        </Suspense>
      </nav>
    </HeaderShell>
  );
}

export function SharedHeader() {
  return (
    <HeaderShell role="shared">
      <Logo href="#" />
    </HeaderShell>
  );
}

/** Sub-navigation inside a clinician's patient record. */
function PatientRecordTabsInner() {
  const { pid } = useParams<{ pid: string }>();
  const base = `/doctor/patients/${pid}`;
  const items = [
    { href: base, label: "Overview" },
    { href: `${base}/sessions`, label: "Sessions" },
    { href: `${base}/compare`, label: "Compare" },
    { href: `${base}/suggestions`, label: "Drafts" },
    { href: `${base}/sharing`, label: "Sharing & privacy" },
  ];
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto">
      {items.map((it) => {
        const active = it.href === base ? pathname === base : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "relative whitespace-nowrap px-3 py-3 text-[14px] font-medium transition-colors",
              active ? "text-brand" : "text-ink-2 hover:text-ink",
            )}
          >
            {it.label}
            {active && <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-brand" />}
          </Link>
        );
      })}
    </div>
  );
}

export function PatientRecordTabs() {
  return (
    <div className="no-print border-b border-line">
      <Suspense fallback={<div className="h-[46px]" />}>
        <PatientRecordTabsInner />
      </Suspense>
    </div>
  );
}
