import { notFound } from "next/navigation";
import { LiveRecorder } from "@/components/LiveRecorder";
import { getStore } from "@/lib/store";
import { EXERCISES } from "@/lib/types";

export const metadata = { title: "New measurement" };

export default async function PatientRecord({ params }: PageProps<"/patient/[pid]/record">) {
  const { pid } = await params;
  const store = await getStore();
  const p = await store.getPatient(pid);
  if (!p) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-[30px] font-semibold">New measurement</h1>
        <p className="mt-1 max-w-2xl text-ink-2">
          Connect your muscle sensor and watch your effort live. Record one or more sets, then save them as a session. Your clinician will see it too.
        </p>
      </div>
      <LiveRecorder
        patientId={pid}
        as="patient"
        exercises={p.exercises.map((e) => ({ key: e, ...EXERCISES[e] }))}
        defaultLocation="home"
        sessionHrefBase={`/patient/${pid}/sessions`}
      />
    </div>
  );
}
