// =============================================================================
// page.tsx : NEW MEASUREMENT PAGE
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Loads the patient and their prescribed weight, then shows the live recorder (components/LiveRecorder.tsx),
//   where the clinician connects the sensor, names the session, types the weight for each set (kg or lb) and records.
// =============================================================================

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
          Stream a MyoWare Wireless Shield over Bluetooth, type the weight for each set, and record live. Reps are counted from EMG and from the accelerometer and cross-checked before the session is saved to {p.firstName}’s record. Uses Web Bluetooth (Chrome or Edge).
        </p>
      </div>
      <LiveRecorder
        patientId={pid}
        as="clinician"
        exercises={p.exercises.map((e) => ({ key: e, ...EXERCISES[e] }))}
        defaultLocation="clinic"
        sessionHrefBase={`/doctor/patients/${pid}/sessions`}
        prescribedLoad={p.prescribedLoad}
      />
    </div>
  );
}
