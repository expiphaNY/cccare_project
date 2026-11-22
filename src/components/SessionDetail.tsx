// =============================================================================
// SessionDetail.tsx : ONE SESSION, FOR THE CLINICIAN
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Session, then set, then raw signal. Shows the chosen set's signals, the one-line rep count with the
//   muscle-versus-movement cross-check, notes, the wrap-up button for the assistant, and a table of the
//   raw samples with a CSV download. It also warns when the sensor's envelope was stuck at its maximum,
//   so peaks are known to be too low.
// =============================================================================

import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleCheck, Download, Dumbbell, Home, MapPin, TriangleAlert } from "lucide-react";
import { METRICS, metricAvailable, type MetricKey } from "@/lib/analytics";
import { clinicianById } from "@/lib/data";
import { DEMO } from "@/lib/demo";
import { fmtDate, fmtTime } from "@/lib/format";
import type { Patient, Recording, Session, SignalData } from "@/lib/types";
import { EXERCISES, fmtLoad } from "@/lib/types";
import { REP_STATUS } from "@/lib/rep-verify";
import { SignalViewer } from "./charts/SignalViewer";
import { RepBars } from "./charts/Sparkline";
import { NoteForm } from "./NoteForm";
import { NoteList } from "./NoteList";
import { WrapUpButton } from "./agent/WrapUpButton";
import { agentTarget } from "@/lib/agent/target";
import { Badge, Card, CardHeader, DepthLadder, cx } from "./ui";

/** Session → set → raw signal, for the clinician. */
export function SessionDetail({
  patient,
  session,
  sessions,
  recordings,
  selectedId,
  baseHref,
  access,
  audience,
  rawPreview,
}: {
  patient: Patient;
  session: Session;
  sessions: Session[];
  recordings: Recording[];
  selectedId?: string;
  baseHref: string;
  access: string;
  audience: "clinician";
  rawPreview?: SignalData | null;
}) {
  const idx = sessions.findIndex((s) => s.id === session.id);
  const prev = sessions[idx - 1];
  const next = sessions[idx + 1];
  const recs = recordings.filter((r) => r.sessionId === session.id);
  const selected = recs.find((r) => r.id === selectedId) ?? recs.reduce((a, b) => (b.metrics.peakEnvelope > a.metrics.peakEnvelope ? b : a), recs[0]);
  const prevRecs = prev ? recordings.filter((r) => r.sessionId === prev.id && r.exercise === selected?.exercise) : [];
  const prevBestRec = prevRecs.length ? prevRecs.reduce((a, b) => (b.metrics.peakEnvelope > a.metrics.peakEnvelope ? b : a)) : null;
  const prevBest = prevBestRec?.metrics.peakEnvelope ?? null;
  const prevBestLoad = prevBestRec?.load ? fmtLoad(prevBestRec.load) : "";
  const sessionLoads = [...new Set(recs.map((r) => fmtLoad(r.load)).filter((l) => l !== "—"))];
  const clin = clinicianById(session.clinicianId);
  const metricKeys: MetricKey[] = (["peakEnvelope", "meanEnvelope", "rms", "iemg", "medianFreqHz", "fatigueIndex"] as MetricKey[]).filter((k) => !selected || metricAvailable(selected, k));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="display text-[24px] font-semibold">{fmtDate(session.startedAt, { weekday: "long" })}</h2>
            <Badge>
              {session.location === "clinic" ? <MapPin className="size-3" aria-hidden /> : <Home className="size-3" aria-hidden />}
              {session.location === "clinic" ? `Clinic${clin ? ` · ${clin.name}` : ""}` : "Home exercise"}
            </Badge>
            <Badge>
              Session {idx + 1} of {sessions.length}
            </Badge>
            {session.painScore != null && <Badge tone={session.painScore >= 5 ? "warn" : "neutral"}>Pain {session.painScore}/10</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-2">
            Started {fmtTime(session.startedAt)} · {recs.length} set{recs.length === 1 ? "" : "s"} recorded by {recs[0]?.source === "ble" ? recs[0].deviceId : patient.device.id}
            {sessionLoads.length > 0 && <> · {sessionLoads.join(", ")}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {audience === "clinician" && <WrapUpButton />}
          <DepthLadder level={selectedId ? 3 : 1} />
          <nav className="flex gap-1" aria-label="Session navigation">
            <NavBtn href={prev ? `${baseHref}/${prev.id}` : undefined} label="Previous session">
              <ChevronLeft className="size-4" aria-hidden />
            </NavBtn>
            <NavBtn href={next ? `${baseHref}/${next.id}` : undefined} label="Next session">
              <ChevronRight className="size-4" aria-hidden />
            </NavBtn>
          </nav>
        </div>
      </div>

      {/* Set picker: macro → micro */}
      <div className="grid gap-4 md:grid-cols-2" {...agentTarget("set-picker", "Set picker: the sets recorded in this session")}>
        {patient.exercises.map((ex) => {
          const sets = recs.filter((r) => r.exercise === ex);
          if (!sets.length) return null;
          return (
            <Card key={ex} className="p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[15px] font-semibold">{EXERCISES[ex].name}</h3>
                <span className="text-[12px] text-ink-3">{EXERCISES[ex].muscle}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {sets.map((r) => {
                  const active = r.id === selected?.id;
                  return (
                    <Link
                      key={r.id}
                      href={`${baseHref}/${session.id}?set=${r.id}`}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      className={cx(
                        "pressable rounded-xl border px-3 py-2.5",
                        active ? "border-brand bg-brand-tint ring-2 ring-brand/15" : "border-line hover:border-line-strong",
                      )}
                    >
                      <div className="text-[12px] text-ink-2">
                        Set {r.setNumber} · {fmtTime(r.recordedAt)}
                      </div>
                      <div className="tabular text-lg font-semibold">
                        {r.metrics.peakEnvelope.toFixed(2)}
                        <span className="ml-0.5 text-[12px] font-normal text-ink-3">mV</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-2">
                        <Dumbbell className="size-3 text-ink-3" aria-hidden /> {fmtLoad(r.load)}
                      </div>
                      <RepLine r={r} />
                    </Link>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      {selected && (
        <>
          <Card {...agentTarget("signal-chart", "Muscle signal chart for the selected set (shaded bands = reps)")}>
            <CardHeader
              eyebrow={`Set ${selected.setNumber} · ${fmtTime(selected.recordedAt)} · ${selected.durationS}s @ ${selected.sampleRateHz} Hz`}
              title={`${EXERCISES[selected.exercise].name} — signal${selected.load ? ` · ${fmtLoad(selected.load)}` : ""}`}
              subtitle="Shaded bands = detected contractions. Below the EMG, the accelerometer and a rep cross-check confirm each rep with movement. Drag, use the slider, +/− keys or pinch to zoom; cursor is synced across charts."
            />
            {(selected.capture?.clippedPct ?? 0) >= 2 && !selected.capture?.rawStreamed && (
              <p className="mx-5 mt-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn sm:mx-6" role="note">
                {`Sensor envelope at its maximum for ${selected.capture!.clippedPct}% of this set: peaks were cut off, so peak and area values here are underestimates.`}
              </p>
            )}
            <div className="pt-4">
              <SignalViewer key={selected.id} recordingId={selected.id} access={access} audience={audience} tremor={selected.tremor} />
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2" {...agentTarget("set-metrics", "Numbers for the selected set")}>
              <CardHeader title="Set metrics" />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 pb-5 pt-4 sm:grid-cols-3 sm:px-6">
                {metricKeys.map((k) => (
                  <div key={k} {...agentTarget(`metric-${k}`, `${METRICS[k].label} for this set`)}>
                    <dt className="text-[12px] text-ink-2" title={METRICS[k].help}>
                      {METRICS[k].label}
                    </dt>
                    <dd className="tabular mt-0.5 text-xl font-semibold">
                      {(selected.metrics[k] as number).toFixed(METRICS[k].digits)}
                      <span className="ml-1 text-[13px] font-normal text-ink-3">{METRICS[k].unit}</span>
                    </dd>
                    <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{METRICS[k].help}</p>
                  </div>
                ))}
              </dl>
              {prevBest != null && (
                <p className="border-t border-line px-5 py-3 text-[13px] text-ink-2 sm:px-6" {...agentTarget("previous-comparison", "Comparison with the previous session")}>
                  Previous session best{prevBestLoad ? ` (${prevBestLoad})` : ""}:{" "}
                  <b className="text-ink tabular">{prevBest.toFixed(2)} mV</b>
                  {" → "}
                  <b className="text-ink tabular">{selected.metrics.peakEnvelope.toFixed(2)} mV</b> (
                  {(((selected.metrics.peakEnvelope - prevBest) / prevBest) * 100).toFixed(0)}%)
                </p>
              )}
            </Card>
            <Card {...agentTarget("rep-bars", "Peak of each repetition in this set")}>
              <CardHeader title="Per-rep peak" subtitle="Envelope maximum per contraction" />
              <div className="px-5 pb-5 pt-4 sm:px-6">
                <RepBars values={selected.metrics.repPeaks} height={88} />
                {selected.metrics.repMedianFreq.length > 0 && metricAvailable(selected, "medianFreqHz") && (
                  <p className="mt-3 text-[12px] text-ink-2">
                    MDF per rep (Hz): <span className="tabular text-ink">{selected.metrics.repMedianFreq.map((f) => f.toFixed(0)).join(" · ")}</span>
                  </p>
                )}
              </div>
            </Card>
          </div>

          {audience === "clinician" && rawPreview && (
            <Card>
              <CardHeader
                eyebrow="Lowest level"
                title="Raw samples"
                subtitle={`${rawPreview.envelope.length.toLocaleString()} samples × ${rawPreview.raw.length ? "3 channels" : "envelope only"}${rawPreview.motion ? " + accelerometer" : ""}. First 40 shown.`}
                action={
                  DEMO ? null : <a href={`/api/export/csv?rid=${selected.id}&${access}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[13px] font-medium text-brand hover:bg-brand-tint">
                    <Download className="size-3.5" aria-hidden /> Download CSV
                  </a>
                }
              />
              <div className="mt-3 max-h-72 overflow-auto border-t border-line">
                <table className="w-full font-mono text-[12px]">
                  <thead className="sticky top-0 bg-white text-left text-ink-2">
                    <tr>
                      <th className="px-5 py-2 font-medium sm:px-6">i</th>
                      <th className="px-3 py-2 font-medium">t (s)</th>
                      <th className="px-3 py-2 text-right font-medium">raw (mV)</th>
                      <th className="px-3 py-2 text-right font-medium">rectified (mV)</th>
                      <th className="px-5 py-2 text-right font-medium sm:px-6">envelope (mV)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 40 }, (_, i) => (
                      <tr key={i} className="border-t border-line/70">
                        <td className="px-5 py-1 text-ink-3 sm:px-6">{i}</td>
                        <td className="px-3 py-1">{(i / rawPreview.sampleRateHz).toFixed(3)}</td>
                        <td className="px-3 py-1 text-right">{rawPreview.raw.length ? rawPreview.raw[i].toFixed(5) : "–"}</td>
                        <td className="px-3 py-1 text-right">{rawPreview.rectified.length ? rawPreview.rectified[i].toFixed(5) : "–"}</td>
                        <td className="px-5 py-1 text-right sm:px-6">{rawPreview.envelope[i].toFixed(5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-line px-5 py-3 text-[12px] text-ink-3 sm:px-6">
                Source:{" "}
                {selected.source === "synthetic"
                  ? "synthetic generator (seeded)"
                  : selected.source === "ble"
                    ? `${selected.capture?.transport === "demo" ? "simulated demo sensor, recorded live" : "live Bluetooth recording"} from ${selected.deviceId}${selected.capture ? ` (${selected.capture.observedRateHz} Hz received, resampled to ${selected.sampleRateHz} Hz${selected.capture.rawStreamed ? `; raw EMG streamed${selected.capture.highpassHz ? ` and ${selected.capture.highpassHz} Hz high-passed` : ""}, rectified and envelope derived from it` : ""}${selected.capture.clippedPct ? `; sensor envelope at its maximum ${selected.capture.clippedPct}% of the time` : ""})` : ""}`
                    : `device ${selected.deviceId}`} · units {selected.units} ·
                recording id <span className="font-mono">{selected.id}</span>
              </p>
            </Card>
          )}
        </>
      )}

      <Card {...agentTarget("session-notes", "Clinician notes for this session")}>
        <CardHeader title="Session notes" />
        <div className="px-5 pb-5 pt-3 sm:px-6">
          {session.notes ? (
            <NoteList patientId={patient.id} sessionId={session.id} notes={session.notes} editable={audience === "clinician"} />
          ) : (
            <p className="text-sm text-ink-2">No notes for this session.</p>
          )}
          {audience === "clinician" && <NoteForm patientId={patient.id} sessionId={session.id} />}
        </div>
      </Card>
    </div>
  );
}

function NavBtn({ href, label, children }: { href?: string; label: string; children: React.ReactNode }) {
  const cls = "flex size-9 items-center justify-center rounded-full border border-line-strong bg-white";
  return href ? (
    <Link href={href} aria-label={label} title={label} className={cx(cls, "pressable text-ink hover:bg-brand-tint")}>
      {children}
    </Link>
  ) : (
    <span aria-hidden className={cx(cls, "text-line-strong")}>
      {children}
    </span>
  );
}

/** One-line rep count with the EMG/accelerometer cross-check. */
function RepLine({ r }: { r: Recording }) {
  const c = r.repCheck;
  if (!c || c.status === "no-motion") return <div className="text-[12px] text-ink-2">{r.metrics.repsDetected} reps · EMG only</div>;
  const st = REP_STATUS[c.status];
  return (
    <div className={cx("mt-0.5 flex items-center gap-1 text-[12px]", st.tone === "good" ? "text-good" : st.tone === "bad" ? "text-bad" : "text-warn")} title={`${st.label}: EMG ${c.emgReps}, movement ${c.motionReps}. ${st.help}`}>
      {c.status === "verified" ? <CircleCheck className="size-3" aria-hidden /> : <TriangleAlert className="size-3" aria-hidden />}
      {c.verifiedReps} verified{c.status !== "verified" && ` · ${c.emgReps}/${c.motionReps}`}
    </div>
  );
}
