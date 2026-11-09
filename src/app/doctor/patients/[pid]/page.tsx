import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Home, MapPin, NotebookPen } from "lucide-react";
import { ExerciseCards } from "@/components/ExerciseCards";
import { TrendPanel } from "@/components/charts/TrendPanel";
import { RepBars, Sparkline } from "@/components/charts/Sparkline";
import { AccessLog } from "@/components/transparency";
import { Badge, Card, CardHeader } from "@/components/ui";
import { shouldLog } from "@/lib/access";
import { clinicianActor, getPatientBundle, logAccess } from "@/lib/data";
import { fmtDate, fmtShortDate, fmtTime, fullName } from "@/lib/format";
import { getStore } from "@/lib/store";
import { EXERCISES } from "@/lib/types";
import { summaries, trendProps } from "@/lib/viewmodels";

export default async function PatientOverview({ params }: PageProps<"/doctor/patients/[pid]">) {
  const { pid } = await params;
  const bundle = await getPatientBundle(pid);
  if (!bundle) notFound();
  const { patient: p, sessions, recordings } = bundle;
  if (shouldLog(`clin|${pid}|profile`, 10 * 60_000)) await logAccess(pid, clinicianActor, "profile_viewed", "Opened patient overview.");
  const store = await getStore();
  const audit = await store.listAudit(pid);

  const sums = summaries(p, recordings);
  const base = `/doctor/patients/${pid}`;
  const latest = sessions[sessions.length - 1];
  const latestRecs = latest ? recordings.filter((r) => r.sessionId === latest.id) : [];
  const latestBest = latestRecs.length ? latestRecs.reduce((a, b) => (b.metrics.peakEnvelope > a.metrics.peakEnvelope ? b : a)) : null;
  const notes = sessions.filter((s) => s.notes).slice(-4).reverse();
  const pain = sessions.filter((s) => s.painScore != null).map((s) => s.painScore!);

  if (!sessions.length)
    return (
      <Card className="p-10 text-center">
        <p className="title text-lg font-semibold">No recordings yet</p>
        <p className="mt-1 text-sm text-ink-2">
          Pair device {p.device.id} and record a first session. Data arrives via the device upload API (<code>/api/ingest</code>).
        </p>
      </Card>
    );

  return (
    <div className="space-y-6">
      <ExerciseCards summaries={sums} compareHref={`${base}/compare`} audience="clinician" />

      <Card>
        <CardHeader title="Trends" subtitle="One point per session (strongest set). Click a point to open that session." />
        <div className="pt-3">
          <TrendPanel
            {...trendProps(p, recordings, ["peakEnvelope", "meanEnvelope", "rms", "iemg", "medianFreqHz", "fatigueIndex"], sessions)}
            audience="clinician"
            sessionHref={`${base}/sessions`}
          />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent sessions"
            action={
              <Link href={`${base}/sessions`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                All {sessions.length} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {[...sessions]
              .reverse()
              .slice(0, 5)
              .map((s) => {
                const recs = recordings.filter((r) => r.sessionId === s.id);
                return (
                  <li key={s.id}>
                    <Link href={`${base}/sessions/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-brand-tint/60 sm:px-6">
                      <span className="w-28 text-sm font-medium tabular">{fmtDate(s.startedAt)}</span>
                      <span className="inline-flex w-20 items-center gap-1 text-[13px] text-ink-2">
                        {s.location === "clinic" ? <MapPin className="size-3.5" aria-hidden /> : <Home className="size-3.5" aria-hidden />}
                        {s.location === "clinic" ? "Clinic" : "Home"}
                      </span>
                      <span className="flex flex-1 flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-ink-2">
                        {p.exercises.map((ex) => {
                          const r = recs.filter((x) => x.exercise === ex);
                          if (!r.length) return null;
                          const best = Math.max(...r.map((x) => x.metrics.peakEnvelope));
                          return (
                            <span key={ex}>
                              {EXERCISES[ex].name}: <b className="font-semibold text-ink tabular">{best.toFixed(2)} mV</b>
                            </span>
                          );
                        })}
                      </span>
                      {s.notes && <NotebookPen className="size-3.5 text-ink-3" aria-label="Has notes" />}
                      <ArrowRight className="size-4 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                );
              })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Latest session" subtitle={latest ? `${fmtDate(latest.startedAt)} · ${fmtTime(latest.startedAt)}` : undefined} />
          {latestBest && (
            <div className="space-y-4 px-5 pb-5 pt-4 sm:px-6">
              <div>
                <div className="text-[12px] text-ink-2">
                  Strongest set · {EXERCISES[latestBest.exercise].name}, set {latestBest.setNumber}
                </div>
                <div className="mt-2">
                  <RepBars values={latestBest.metrics.repPeaks} />
                </div>
                <div className="mt-2 flex justify-between text-[12px] text-ink-2">
                  <span>Peak per rep</span>
                  <span>
                    Fatigue <b className="text-ink tabular">{latestBest.metrics.fatigueIndex.toFixed(0)}%</b> · MDF{" "}
                    <b className="text-ink tabular">{latestBest.metrics.medianFreqHz.toFixed(0)} Hz</b>
                  </span>
                </div>
              </div>
              {pain.length > 1 && (
                <div className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2.5">
                  <div>
                    <div className="text-[12px] text-ink-2">Pain (patient-reported, 0–10)</div>
                    <div className="text-sm font-semibold tabular">
                      {pain[0]} → {pain[pain.length - 1]}
                    </div>
                  </div>
                  <Sparkline values={pain} color="#5c6b82" width={90} />
                </div>
              )}
              <Link href={`${base}/sessions/${latest!.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                Open session & raw signals <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Clinical notes" />
          <ul className="space-y-3 px-5 pb-5 pt-4 sm:px-6">
            {notes.length ? (
              notes.map((s) => (
                <li key={s.id} className="rounded-xl bg-canvas px-3 py-2.5">
                  <Link href={`${base}/sessions/${s.id}`} className="text-[12px] font-medium text-brand hover:underline">
                    {fmtShortDate(s.startedAt)}
                  </Link>
                  <p className="whitespace-pre-line text-sm">{s.notes}</p>
                </li>
              ))
            ) : (
              <li className="text-sm text-ink-2">No notes yet.</li>
            )}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Recent access"
            subtitle={`What ${p.firstName} sees in their access log.`}
            action={
              <Link href={`${base}/sharing`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                Full log <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          <div className="px-5 pb-5 pt-4 sm:px-6">
            <AccessLog events={audit} audience="clinician" limit={5} />
          </div>
        </Card>
      </div>
      <p className="text-center text-[12px] text-ink-3">
        <Badge>Synthetic data</Badge> {fullName(p)} is a demo patient. Signals are generated deterministically to mimic the device output.
      </p>
    </div>
  );
}
