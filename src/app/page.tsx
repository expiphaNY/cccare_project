// =============================================================================
// page.tsx : THE LANDING PAGE
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The first page anyone sees. It explains the app in a few lines and leads to the clinician dashboard. (The app is clinician-only; there is no patient login.)
// =============================================================================

import Link from "next/link";
import { ArrowRight, Eye, Lock, ShieldCheck, Stethoscope, Trash2 } from "lucide-react";
import { Logo } from "@/components/nav";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(1200px_600px_at_50%_-10%,#dbe9fb_0%,#f4f7fb_55%)]">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
        <Logo />
        <Link href="/data-handling" className="ml-auto rounded-full px-3 py-2 text-sm font-medium text-ink-2 hover:bg-white/70 hover:text-brand">
          How we handle data
        </Link>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow !text-brand">Muscle activity, made clear</p>
          <h1 className="display mt-3 text-[40px] font-semibold sm:text-[56px]">Verified reps. Measured effort.</h1>
          <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-ink-2">
            MyoCare pairs EMG with an accelerometer so every rep is cross-checked, every load is logged, and progress is easy to defend.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-xl">
          <Link
            href="/doctor"
            className="pressable group flex flex-col rounded-[22px] border border-line bg-white p-6 shadow-[var(--shadow-card)] hover:border-brand/40 hover:shadow-[var(--shadow-pop)]"
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-brand text-white">
              <Stethoscope className="size-5" aria-hidden />
            </span>
            <h2 className="title mt-5 text-xl font-semibold">Clinician dashboard</h2>
            <p className="mt-1 text-[15px] text-ink-2">
              Patient list, live recording with load tracking, EMG and accelerometer rep verification, trends, sharing and exports.
            </p>
            <span className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-brand">
              Open dashboard <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
            <span className="mt-1 text-[12px] text-ink-3">Signed in as Dr. Amelia Hart (demo)</span>
          </Link>
        </div>

        <ul className="mx-auto mt-14 grid max-w-4xl gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            { Icon: Eye, t: "Every view is logged", d: "Who opened a record, and when." },
            { Icon: Lock, t: "Links expire", d: "Shares are time-limited and revocable." },
            { Icon: ShieldCheck, t: "Standard formats", d: "Export to FHIR R4, PDF or offline HTML." },
            { Icon: Trash2, t: "Delete anytime", d: "Remove a profile and get a receipt." },
          ].map((f) => (
            <li key={f.t} className="flex gap-3">
              <f.Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <span>
                <span className="block font-medium">{f.t}</span>
                <span className="text-ink-2">{f.d}</span>
              </span>
            </li>
          ))}
        </ul>
      </main>

      <footer className="pb-8 text-center text-[12px] text-ink-3">Demo build · all patients and recordings are synthetic.</footer>
    </div>
  );
}
