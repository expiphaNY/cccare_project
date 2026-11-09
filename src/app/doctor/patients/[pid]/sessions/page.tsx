import { notFound } from "next/navigation";
import { SessionsTable } from "@/components/SessionsTable";
import { Card, CardHeader } from "@/components/ui";
import { getPatientBundle } from "@/lib/data";

export default async function DoctorSessions({ params }: PageProps<"/doctor/patients/[pid]/sessions">) {
  const { pid } = await params;
  const b = await getPatientBundle(pid);
  if (!b) notFound();
  return (
    <Card>
      <CardHeader title="All sessions" subtitle="Each session holds sets of bicep curls. Open one to see signals." />
      <div className="mt-3 border-t border-line">
        <SessionsTable patient={b.patient} sessions={b.sessions} recordings={b.recordings} baseHref={`/doctor/patients/${pid}/sessions`} audience="clinician" />
      </div>
    </Card>
  );
}
