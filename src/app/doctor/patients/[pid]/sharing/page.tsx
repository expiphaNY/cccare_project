import { notFound } from "next/navigation";
import { ShareDialog } from "@/components/ShareDialog";
import { AccessLog, SharesTable, WhoCanSee } from "@/components/transparency";
import { ConsentToggles, DeleteProfile, ExportLinks } from "@/components/privacy";
import { Card, CardHeader } from "@/components/ui";
import { accessSummary, getPatientBundle } from "@/lib/data";
import { fmtDate, fullName } from "@/lib/format";
import { getStore } from "@/lib/store";

export default async function DoctorSharing({ params }: PageProps<"/doctor/patients/[pid]/sharing">) {
  const { pid } = await params;
  const b = await getPatientBundle(pid);
  if (!b) notFound();
  const store = await getStore();
  const [shares, audit, who] = await Promise.all([store.listShares(pid), store.listAudit(pid), accessSummary(b.patient)]);
  const p = b.patient;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Share links"
            subtitle="Time-limited, revocable links. Opening a link is logged and shown to the patient."
            action={
              <ShareDialog
                as="clinician"
                patientId={pid}
                patientName={fullName(p)}
                triggerLabel="New link"
                triggerVariant="secondary"
                sessions={[...b.sessions].reverse().map((s) => ({ id: s.id, label: fmtDate(s.startedAt) }))}
              />
            }
          />
          <div className="px-5 pb-3 pt-2 sm:px-6">
            <SharesTable shares={shares} as="clinician" patientId={pid} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Access log" subtitle={`Every view, export, share and consent change. ${p.firstName} sees this same list.`} />
          <div className="max-h-[640px] overflow-y-auto px-5 pb-5 pt-4 sm:px-6">
            <AccessLog events={audit} audience="clinician" />
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Who can see this record" />
          <div className="px-5 pb-5 pt-4 sm:px-6">
            <WhoCanSee people={who.people.map((x) => (x.kind === "you" ? { ...x, who: `${fullName(p)} (patient)`, why: "Full access, always." } : x))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Consent" subtitle="Normally set by the patient. Changes here are logged as made by you." />
          <div className="px-5 pb-4 sm:px-6">
            <ConsentToggles as="clinician" patientId={pid} consent={p.consent} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Export full record" subtitle="For transfer of care. Includes full history." />
          <div className="px-5 pb-5 pt-4 sm:px-6">
            <ExportLinks query={`patient=${pid}&as=clinician`} compact />
          </div>
        </Card>
        <Card className="border-[#f1d3d1]">
          <CardHeader title="Delete profile" subtitle="Permanently removes all data. Use when the patient asks, or retention ends." />
          <div className="px-5 pb-5 pt-4 sm:px-6">
            <DeleteProfile
              as="clinician"
              patientId={pid}
              patientName={fullName(p)}
              counts={{ sessions: b.sessions.length, recordings: b.recordings.length, shares: shares.length }}
              exportQuery={`patient=${pid}&as=clinician`}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
