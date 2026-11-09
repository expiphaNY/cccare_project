import { notFound } from "next/navigation";
import { SessionsTable } from "@/components/SessionsTable";
import { Card, CardHeader } from "@/components/ui";
import { getPatientBundle } from "@/lib/data";

export const metadata = { title: "My sessions" };

export default async function PatientSessions({ params }: PageProps<"/patient/[pid]/sessions">) {
  const { pid } = await params;
  const b = await getPatientBundle(pid);
  if (!b) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-[30px] font-semibold">Your sessions</h1>
        <p className="mt-1 text-ink-2">Every time you exercised with the sensor. Open one to see each set and the actual signal from your muscle.</p>
      </div>
      <Card>
        <CardHeader title={`${b.sessions.length} sessions`} subtitle="Newest first. The bar shows how that day compares with your best." />
        <div className="mt-3 border-t border-line">
          <SessionsTable patient={b.patient} sessions={b.sessions} recordings={b.recordings} baseHref={`/patient/${pid}/sessions`} audience="patient" />
        </div>
      </Card>
    </div>
  );
}
