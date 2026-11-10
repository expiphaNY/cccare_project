import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Database, FileQuestion, Lock, MapPin, Scale } from "lucide-react";
import { ShareDialog } from "@/components/ShareDialog";
import { AccessLog, DataFlow, SharesTable, SignalExplainer, WhoCanSee } from "@/components/transparency";
import { ConsentToggles, DeleteProfile, ExportLinks } from "@/components/privacy";
import { Card, CardHeader } from "@/components/ui";
import { accessSummary, getPatientBundle } from "@/lib/data";
import { fmtDateTime, fullName } from "@/lib/format";
import { getStore } from "@/lib/store";

export const metadata = { title: "My data" };

export default async function PatientPrivacy({ params }: PageProps<"/patient/[pid]/privacy">) {
  const { pid } = await params;
  const b = await getPatientBundle(pid);
  if (!b) notFound();
  const p = b.patient;
  const store = await getStore();
  const [shares, audit, who] = await Promise.all([store.listShares(pid), store.listAudit(pid), accessSummary(p)]);
  const othersCount = audit.filter((e) => e.actor.role === "clinician" || e.actor.role === "recipient").length;

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <p className="eyebrow !text-brand">My data</p>
        <h1 className="display mt-1 text-[34px] font-semibold">Your data, in plain sight.</h1>
        <p className="mt-2 text-[17px] leading-relaxed text-ink-2">
          What we collect, where it goes, who has looked at it, and how to take it with you or delete it. No fine print.
        </p>
      </div>

      {/* At a glance */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { Icon: Database, k: "What we store", v: `${b.recordings.length} recorded sets from ${b.sessions.length} sessions` },
          { Icon: MapPin, k: "Where", v: p.storageRegion },
          { Icon: Lock, k: "Who can see it", v: `${who.people.length - 1} ${who.people.length - 1 === 1 ? "person" : "people"} besides you` },
          { Icon: Clock, k: "How long", v: "While you’re in care + 10 years, or until you delete it" },
        ].map((x) => (
          <Card key={x.k} className="p-5">
            <x.Icon className="size-5 text-brand" aria-hidden />
            <div className="mt-3 text-[13px] text-ink-2">{x.k}</div>
            <div className="mt-0.5 text-[15px] font-semibold leading-snug">{x.v}</div>
          </Card>
        ))}
      </div>

      <section>
        <h2 className="title text-xl font-semibold">What the sensor measures</h2>
        <p className="mt-1 text-sm text-ink-2">Just one thing — the electrical activity of your muscle — reported three ways. Each set is labelled with the exercise, set number, date and time.</p>
        <div className="mt-4">
          <SignalExplainer />
        </div>
      </section>

      <section>
        <h2 className="title text-xl font-semibold">How it travels</h2>
        <div className="mt-4">
          <DataFlow region={p.storageRegion} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Access log"
              subtitle={`Everything that happened to your record — ${othersCount} view${othersCount === 1 ? "" : "s"} by others so far. Nothing is hidden.`}
            />
            <div className="max-h-[720px] overflow-y-auto px-5 pb-5 pt-4 sm:px-6">
              <AccessLog events={audit} audience="patient" />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Who can see it" />
            <div className="px-5 pb-5 pt-4 sm:px-6">
              <WhoCanSee people={who.people} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Share links"
              subtitle="Send your record to another doctor or a family member."
              action={
                p.consent.patientSharing ? (
                  <ShareDialog
                    as="patient"
                    patientId={pid}
                    patientName={fullName(p)}
                    triggerLabel="Share"
                    triggerVariant="secondary"
                    sessions={[...b.sessions].reverse().map((s) => ({ id: s.id, label: fmtDateTime(s.startedAt) }))}
                  />
                ) : undefined
              }
            />
            <div className="px-5 pb-3 pt-2 sm:px-6">
              <SharesTable shares={shares} as="patient" patientId={pid} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Your choices" subtitle="Change them any time. Takes effect immediately." />
            <div className="px-5 pb-4 sm:px-6">
              <ConsentToggles as="patient" patientId={pid} consent={p.consent} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Download a copy" subtitle="Your full history, in formats other clinics and apps understand." />
            <div className="px-5 pb-5 pt-4 sm:px-6">
              <ExportLinks query={`patient=${pid}&as=patient`} compact />
            </div>
          </Card>

          <Card className="border-[#f1d3d1]">
            <CardHeader title="Delete my profile" subtitle="Removes everything for good. You’ll get a deletion receipt." />
            <div className="px-5 pb-5 pt-4 sm:px-6">
              <DeleteProfile
                as="patient"
                patientId={pid}
                patientName={fullName(p)}
                counts={{ sessions: b.sessions.length, recordings: b.recordings.length, shares: shares.length }}
                exportQuery={`patient=${pid}&as=patient`}
              />
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <Scale className="size-5 text-brand" aria-hidden />
          <div className="min-w-0 flex-1 text-sm text-ink-2">
            <p className="font-semibold text-ink">Your rights</p>
            <p className="mt-1">
              You can see, copy, correct and (where the law allows) delete your health information. Retention rules: {p.retentionPolicy}
            </p>
          </div>
          <Link href="/data-handling" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
            <FileQuestion className="size-4" aria-hidden /> Full data-handling policy
          </Link>
        </div>
      </Card>
    </div>
  );
}
