import { notFound } from "next/navigation";
import { SessionDetail } from "@/components/SessionDetail";
import { SetSwitch } from "@/components/demo/SetSwitch";
import { Breadcrumbs } from "@/components/ui";
import { getPatientBundle } from "@/lib/data";
import { DEMO } from "@/lib/demo";
import { sessionParams } from "@/lib/demo/params";
import { fmtDateTime } from "@/lib/format";

export const generateStaticParams = DEMO ? sessionParams : undefined;

export default async function PatientSession({ params, searchParams }: PageProps<"/patient/[pid]/sessions/[sid]">) {
  const { pid, sid } = await params;
  const sp: Record<string, string | string[] | undefined> = DEMO ? {} : await searchParams;
  const b = await getPatientBundle(pid);
  if (!b) notFound();
  const session = b.sessions.find((s) => s.id === sid);
  if (!session) notFound();
  const detail = (selectedId?: string) => (
    <SessionDetail
      patient={b.patient}
      session={session}
      sessions={b.sessions}
      recordings={b.recordings}
      selectedId={selectedId}
      baseHref={`/patient/${pid}/sessions`}
      access="as=patient"
      audience="patient"
    />
  );
  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: "Progress", href: `/patient/${pid}` },
          { label: "Sessions", href: `/patient/${pid}/sessions` },
          { label: fmtDateTime(session.startedAt) },
        ]}
      />
      {DEMO ? (
        <SetSwitch
          variants={{
            default: detail(),
            ...Object.fromEntries(b.recordings.filter((r) => r.sessionId === sid).map((r) => [r.id, detail(r.id)])),
          }}
        />
      ) : (
        detail(typeof sp.set === "string" ? sp.set : undefined)
      )}
    </div>
  );
}
