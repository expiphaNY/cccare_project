import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Eye, Lock, ShieldCheck, Stethoscope, Trash2, User } from "lucide-react";
import { Logo } from "@/components/nav";
import { Avatar } from "@/components/ui";
import { getStore } from "@/lib/store";
import { fullName, initials } from "@/lib/format";

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
          <h1 className="display mt-3 text-[40px] font-semibold sm:text-[56px]">See your muscles get stronger.</h1>
          <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-ink-2">
            MyoCare turns EMG sensor readings into progress you can understand — and shows you exactly who sees your data, and why.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-5 md:grid-cols-2">
          <Link
            href="/doctor"
            className="pressable group flex flex-col rounded-[22px] border border-line bg-white p-6 shadow-[var(--shadow-card)] hover:border-brand/40 hover:shadow-[var(--shadow-pop)]"
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-brand text-white">
              <Stethoscope className="size-5" aria-hidden />
            </span>
            <h2 className="title mt-5 text-xl font-semibold">I’m a clinician</h2>
            <p className="mt-1 text-[15px] text-ink-2">Patient list, trends, overlay comparisons, raw signals, sharing and exports.</p>
            <span className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-brand">
              Open clinician dashboard <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
            <span className="mt-1 text-[12px] text-ink-3">Signed in as Dr. Amelia Hart (demo)</span>
          </Link>

          <div className="flex flex-col rounded-[22px] border border-line bg-white p-6 shadow-[var(--shadow-card)]">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <User className="size-5" aria-hidden />
            </span>
            <h2 className="title mt-5 text-xl font-semibold">I’m a patient</h2>
            <p className="mt-1 text-[15px] text-ink-2">Your progress in plain language, and full control of your data. Pick a demo patient:</p>
            <Suspense fallback={<div className="mt-4 h-40 animate-pulse rounded-xl bg-canvas" />}>
              <PatientPicker />
            </Suspense>
          </div>
        </div>

        <ul className="mx-auto mt-14 grid max-w-4xl gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            { Icon: Eye, t: "Every view is logged", d: "Patients see who opened their data, and when." },
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

async function PatientPicker() {
  const store = await getStore();
  const patients = await store.listPatients();
  if (!patients.length) return <p className="mt-4 text-sm text-ink-2">No patients yet. Create one from the clinician dashboard.</p>;
  return (
    <ul className="-mx-2 mt-3 max-h-64 overflow-y-auto">
      {patients.map((p) => (
        <li key={p.id}>
          <Link href={`/patient/${p.id}`} className="pressable flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-brand-tint">
            <Avatar text={initials(p)} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{fullName(p)}</span>
              <span className="block truncate text-[12px] text-ink-2">{p.condition}</span>
            </span>
            <ArrowRight className="size-4 text-ink-3" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
