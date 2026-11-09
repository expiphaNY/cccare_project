import Link from "next/link";
import { ChevronRight, Home, MapPin, NotebookPen } from "lucide-react";
import { fmtDate, fmtTime } from "@/lib/format";
import type { Patient, Recording, Session } from "@/lib/types";
import { EXERCISES } from "@/lib/types";

export function SessionsTable({
  patient,
  sessions,
  recordings,
  baseHref,
  audience,
}: {
  patient: Patient;
  sessions: Session[];
  recordings: Recording[];
  baseHref: string;
  audience: "clinician" | "patient";
}) {
  const ordered = [...sessions].reverse();
  const bestFor = (sid: string, ex: string) => {
    const r = recordings.filter((x) => x.sessionId === sid && x.exercise === ex);
    return r.length ? Math.max(...r.map((x) => x.metrics.peakEnvelope)) : null;
  };
  const maxBy = Object.fromEntries(
    patient.exercises.map((ex) => [ex, Math.max(...recordings.filter((r) => r.exercise === ex).map((r) => r.metrics.peakEnvelope), 0.001)]),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-ink-2">
            <th className="px-5 py-3 font-medium sm:px-6">#</th>
            <th className="px-3 py-3 font-medium">Date & time</th>
            <th className="px-3 py-3 font-medium">Where</th>
            {patient.exercises.map((ex) => (
              <th key={ex} className="px-3 py-3 font-medium">
                {EXERCISES[ex].name} <span className="font-normal text-ink-3">{audience === "patient" ? "strongest effort" : "peak"}</span>
              </th>
            ))}
            <th className="px-3 py-3 font-medium">Sets</th>
            <th className="px-3 py-3 font-medium">Pain</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {ordered.map((s, i) => (
            <tr key={s.id} className="group relative border-b border-line last:border-0 hover:bg-brand-tint/60">
              <td className="px-5 py-3 text-ink-3 tabular sm:px-6">{sessions.length - i}</td>
              <td className="px-3 py-3">
                <Link href={`${baseHref}/${s.id}`} className="after:absolute after:inset-0">
                  <span className="block font-medium tabular">{fmtDate(s.startedAt)}</span>
                  <span className="block text-[12px] text-ink-2">{fmtTime(s.startedAt)}</span>
                </Link>
              </td>
              <td className="px-3 py-3 text-ink-2">
                <span className="inline-flex items-center gap-1">
                  {s.location === "clinic" ? <MapPin className="size-3.5" aria-hidden /> : <Home className="size-3.5" aria-hidden />}
                  {s.location === "clinic" ? "Clinic" : "Home"}
                  {s.notes && <NotebookPen className="ml-1 size-3.5 text-ink-3" aria-label="Has notes" />}
                </span>
              </td>
              {patient.exercises.map((ex) => {
                const v = bestFor(s.id, ex);
                return (
                  <td key={ex} className="px-3 py-3">
                    {v == null ? (
                      <span className="text-ink-3">–</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="w-14 tabular">{v.toFixed(2)} mV</span>
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[#e9eef5]">
                          <span className="block h-full rounded-full bg-brand/70" style={{ width: `${(v / maxBy[ex]) * 100}%` }} />
                        </span>
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="px-3 py-3 tabular text-ink-2">{recordings.filter((r) => r.sessionId === s.id).length}</td>
              <td className="px-3 py-3 tabular text-ink-2">{s.painScore ?? "–"}</td>
              <td className="px-3 py-3 text-ink-3">
                <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
