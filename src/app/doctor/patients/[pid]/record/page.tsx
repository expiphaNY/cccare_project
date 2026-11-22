// =============================================================================
// page.tsx : NEW MEASUREMENT PAGE
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Loads the clinic's default weight unit and the patient's prescribed weight, then shows the live
//   recorder (components/LiveRecorder.tsx), where the clinician connects the sensor and records sets.
// =============================================================================

import { notFound } from "next/navigation";
import { LiveRecorder } from "@/components/LiveRecorder";
import { getStore } from "@/lib/store";
import { EXERCISES } from "@/lib/types";

export const metadata = { title: "New measurement" };

export default async function ClinicianRecord({ params }: PageProps<"/doctor/patients/[pid]/record">) {
  const { pid } = await params;
  const store = await getStore();
  const [p, weights] = await Promise.all([store.getPatient(pid), store.getWeightSettings()]);
  if (!p) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="display text-[24px] font-semibold">New measurement</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Stream a MyoWare Wireless Shield over Bluetooth, pick the weight for each set, and record live. Reps are counted from EMG and from the accelerometer and cross-checked before the session is saved to {p.firstName}’s record. Uses Web Bluetooth (Chrome or Edge).
        </p>
      </div>
      <LiveRecorder
        patientId={pid}
        as="clinician"
        exercises={p.exercises.map((e) => ({ key: e, ...EXERCISES[e] }))}
        defaultLocation="clinic"
        sessionHrefBase={`/doctor/patients/${pid}/sessions`}
        weights={weights}
        prescribedLoad={p.prescribedLoad}
      />
    </div>
  );
}
