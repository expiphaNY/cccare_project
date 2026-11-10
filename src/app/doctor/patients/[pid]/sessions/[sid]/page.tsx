import { notFound } from "next/navigation";
import { SessionDetail } from "@/components/SessionDetail";
import { SetSwitch } from "@/components/demo/SetSwitch";
import { shouldLog } from "@/lib/access";
import { clinicianActor, getPatientBundle, logAccess } from "@/lib/data";
import { DEMO } from "@/lib/demo";
import { sessionParams } from "@/lib/demo/params";
import { fmtDateTime } from "@/lib/format";
import { getStore } from "@/lib/store";

export const generateStaticParams = DEMO ? sessionParams : undefined;

export default async function DoctorSessionPage({ params, searchParams }: PageProps<"/doctor/patients/[pid]/sessions/[sid]">) {
  const { pid, sid } = await params;
  const sp: Record<string, string | string[] | undefined> = DEMO ? {} : await searchParams;
  const bundle = await getPatientBundle(pid);
  if (!bundle) notFound();
  const session = bundle.sessions.find((s) => s.id === sid);
  if (!session) notFound();
  if (shouldLog(`clin|${sid}|session`, 10 * 60_000))
    await logAccess(pid, clinicianActor, "session_viewed", `Opened session of ${fmtDateTime(session.startedAt)}.`);

  const recs = bundle.recordings.filter((r) => r.sessionId === sid);
  const store = await getStore();

  const detail = async (setId?: string) => {
    const selected = recs.find((r) => r.id === setId) ?? recs.reduce((a, b) => (b.metrics.peakEnvelope > a.metrics.peakEnvelope ? b : a), recs[0]);
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
  };

  // Static demo: no server to read `?set=`, so prerender every set and let the client pick.
  if (DEMO) {
    const entries = await Promise.all(recs.map(async (r) => [r.id, await detail(r.id)] as const));
    return <SetSwitch variants={{ default: await detail(), ...Object.fromEntries(entries) }} />;
  }
  return detail(typeof sp.set === "string" ? sp.set : undefined);
}
