import { notFound } from "next/navigation";
import { SessionDetail } from "@/components/SessionDetail";
import { Breadcrumbs } from "@/components/ui";
import { getPatientBundle } from "@/lib/data";
import { fmtDate } from "@/lib/format";

export default async function PatientSession({ params, searchParams }: PageProps<"/patient/[pid]/sessions/[sid]">) {
  const { pid, sid } = await params;
  const sp = await searchParams;
  const b = await getPatientBundle(pid);
  if (!b) notFound();
  const session = b.sessions.find((s) => s.id === sid);
  if (!session) notFound();
  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: "Progress", href: `/patient/${pid}` },
          { label: "Sessions", href: `/patient/${pid}/sessions` },
          { label: fmtDate(session.startedAt) },
        ]}
      />
      <SessionDetail
        patient={b.patient}
        session={session}
        sessions={b.sessions}
        recordings={b.recordings}
        selectedId={typeof sp.set === "string" ? sp.set : undefined}
        baseHref={`/patient/${pid}/sessions`}
        access="as=patient"
        audience="patient"
      />
    </div>
  );
}
