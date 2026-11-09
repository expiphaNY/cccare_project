import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Cpu, Download, Layers, ShieldCheck } from "lucide-react";
import { PatientRecordTabs } from "@/components/nav";
import { ShareDialog } from "@/components/ShareDialog";
import { ExportLinks } from "@/components/privacy";
import { Avatar, Badge, Breadcrumbs, PageContainer, btn } from "@/components/ui";
import { clinicianById } from "@/lib/data";
import { ageFrom, fmtDate, fullName, initials } from "@/lib/format";
import { getStore } from "@/lib/store";

export default function PatientRecordLayout({ children, params }: LayoutProps<"/doctor/patients/[pid]">) {
  return (
    <PageContainer className="pt-6">
      <Suspense fallback={<div className="h-[148px] animate-pulse rounded-card bg-white" />}>
        <RecordHeader params={params} />
      </Suspense>
      <PatientRecordTabs />
      <div className="pt-6">{children}</div>
    </PageContainer>
  );
}

async function RecordHeader({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const store = await getStore();
  const p = await store.getPatient(pid);
  if (!p) notFound();
  const sessions = await store.listSessions(pid);
  const clin = clinicianById(p.clinicianId);
  return (
    <div>
      <Breadcrumbs items={[{ label: "Patients", href: "/doctor" }, { label: fullName(p) }]} />
      <div className="mt-3 flex flex-wrap items-start gap-4 pb-5">
        <Avatar text={initials(p)} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="display text-[28px] font-semibold">{fullName(p)}</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            {ageFrom(p.dob)} y · <span className="capitalize">{p.sex}</span> · DOB {fmtDate(p.dob)} · MRN <span className="tabular">{p.mrn}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{p.condition}</Badge>
            <Badge className="capitalize">{p.affectedSide} side</Badge>
            <Badge>{sessions.length} sessions</Badge>
            {clin && <Badge>Assigned: {clin.name}</Badge>}
            <Badge title={`${p.device.model} · firmware ${p.device.firmware} · ${p.device.sampleRateHz} Hz`}>
              <Cpu className="size-3" aria-hidden /> {p.device.id}
            </Badge>
            <Badge tone={p.consent.researchDeidentified ? "good" : "neutral"}>
              <ShieldCheck className="size-3" aria-hidden /> Research {p.consent.researchDeidentified ? "consented" : "not consented"}
            </Badge>
          </div>
          <p className="mt-2 text-[13px] text-ink-2">
            <span className="font-medium text-ink">Goal:</span> {p.goal}
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <Link href={`/doctor/patients/${pid}/compare`} className={btn.secondary}>
            <Layers className="size-4" aria-hidden /> Compare
          </Link>
          <details className="relative">
            <summary className={`${btn.secondary} list-none [&::-webkit-details-marker]:hidden`}>
              <Download className="size-4" aria-hidden /> Export
            </summary>
            <div className="fade-in absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-line bg-white p-3 shadow-[var(--shadow-pop)]">
              <ExportLinks query={`patient=${pid}&as=clinician`} compact />
              <p className="mt-2 px-1 text-[12px] text-ink-3">Downloads are recorded in the patient’s access log.</p>
            </div>
          </details>
          <ShareDialog
            as="clinician"
            patientId={pid}
            patientName={fullName(p)}
            sessions={[...sessions].reverse().map((s, i) => ({
              id: s.id,
              label: `${fmtDate(s.startedAt)} · ${s.location === "clinic" ? "Clinic" : "Home"} (session ${sessions.length - i})`,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
