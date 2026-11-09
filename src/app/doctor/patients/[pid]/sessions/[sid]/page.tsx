import { notFound } from "next/navigation";
import { SessionDetail } from "@/components/SessionDetail";
import { shouldLog } from "@/lib/access";
import { clinicianActor, getPatientBundle, logAccess } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { getStore } from "@/lib/store";

export default async function DoctorSessionPage({ params, searchParams }: PageProps<"/doctor/patients/[pid]/sessions/[sid]">) {
  const { pid, sid } = await params;
  const sp = await searchParams;
  const bundle = await getPatientBundle(pid);
  if (!bundle) notFound();
  const session = bundle.sessions.find((s) => s.id === sid);
  if (!session) notFound();
  if (shouldLog(`clin|${sid}|session`, 10 * 60_000))
    await logAccess(pid, clinicianActor, "session_viewed", `Opened session of ${fmtDate(session.startedAt)}.`);

  const setId = typeof sp.set === "string" ? sp.set : undefined;
  const recs = bundle.recordings.filter((r) => r.sessionId === sid);
  const selected = recs.find((r) => r.id === setId) ?? recs.reduce((a, b) => (b.metrics.peakEnvelope > a.metrics.peakEnvelope ? b : a), recs[0]);
  const store = await getStore();
  const raw = selected ? await store.getSignal(selected.id) : null;

  return (
    <SessionDetail
      patient={bundle.patient}
      session={session}
      sessions={bundle.sessions}
      recordings={bundle.recordings}
      selectedId={setId}
      baseHref={`/doctor/patients/${pid}/sessions`}
      access="as=clinician"
      audience="clinician"
      rawPreview={raw}
    />
  );
}
