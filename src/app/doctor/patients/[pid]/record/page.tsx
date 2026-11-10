import { notFound } from "next/navigation";
import { LiveRecorder } from "@/components/LiveRecorder";
import { getStore } from "@/lib/store";
import { EXERCISES } from "@/lib/types";

export const metadata = { title: "New measurement" };

export default async function ClinicianRecord({ params }: PageProps<"/doctor/patients/[pid]/record">) {
  const { pid } = await params;
  const store = await getStore();
  const p = await store.getPatient(pid);
  if (!p) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="display text-[24px] font-semibold">New measurement</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Stream a MyoWare Wireless Shield over Bluetooth, record sets live, and save them to {p.firstName}’s record as a new session. Uses Web Bluetooth (Chrome or Edge).
        </p>
      </div>
      <LiveRecorder
        patientId={pid}
        as="clinician"
        exercises={p.exercises.map((e) => ({ key: e, ...EXERCISES[e] }))}
        defaultLocation="clinic"
        sessionHrefBase={`/doctor/patients/${pid}/sessions`}
      />
    </div>
  );
}
