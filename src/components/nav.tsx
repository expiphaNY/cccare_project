"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Activity, ArrowLeftRight, CalendarDays, Layers, ShieldCheck, TrendingUp } from "lucide-react";
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

function HeaderShell({ children, role }: { children: ReactNode; role: "clinician" | "patient" | "shared" }) {
  const label = { clinician: "Clinician view", patient: "Patient view", shared: "Shared record · read-only" }[role];
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
          {role !== "shared" && (
            <Link
              href="/"
              className="pressable inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-2 hover:bg-brand-soft hover:text-brand"
            >
              <ArrowLeftRight className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Switch view</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLinks({ items, exact }: { items: { href: string; label: string }[]; exact?: string[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((it) => {
        const active = exact?.includes(it.href) ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");
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
    { href: "/doctor", label: "Patients" },
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

function PatientNavInner() {
  const { pid } = useParams<{ pid: string }>();
  const base = `/patient/${pid}`;
  const items = [
    { href: base, label: "Progress" },
    { href: `${base}/sessions`, label: "Sessions" },
    { href: `${base}/compare`, label: "Compare" },
    { href: `${base}/privacy`, label: "My data" },
  ];
  return <NavLinks items={items} exact={[base]} />;
}

export function PatientHeader() {
  return (
    <>
      <HeaderShell role="patient">
        <Logo href="/" />
        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 sm:flex">
          <Suspense fallback={<span className="h-9" />}>
            <PatientNavInner />
          </Suspense>
        </nav>
      </HeaderShell>
      <Suspense fallback={null}>
        <PatientTabBar />
      </Suspense>
    </>
  );
}

/** Phone-sized bottom tab bar (iOS pattern): always-visible primary destinations. */
function PatientTabBar() {
  const { pid } = useParams<{ pid: string }>();
  const pathname = usePathname();
  const base = `/patient/${pid}`;
  const items = [
    { href: base, label: "Progress", Icon: TrendingUp },
    { href: `${base}/sessions`, label: "Sessions", Icon: CalendarDays },
    { href: `${base}/compare`, label: "Compare", Icon: Layers },
    { href: `${base}/privacy`, label: "My data", Icon: ShieldCheck },
  ];
  return (
    <nav
      aria-label="Primary"
      className="material no-print fixed inset-x-0 bottom-0 z-40 border-t border-line/80 pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="grid grid-cols-4">
        {items.map(({ href, label, Icon }) => {
          const active = href === base ? pathname === base : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-brand" : "text-ink-3")}
              >
                <Icon className="size-[22px]" strokeWidth={active ? 2.3 : 1.8} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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
