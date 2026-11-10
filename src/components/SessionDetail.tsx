import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Home, MapPin } from "lucide-react";
import { METRICS, metricAvailable, type MetricKey } from "@/lib/analytics";
import { clinicianById } from "@/lib/data";
import { fmtDate, fmtTime } from "@/lib/format";
import type { Patient, Recording, Session, SignalData } from "@/lib/types";
import { EXERCISES } from "@/lib/types";
import { SignalViewer } from "./charts/SignalViewer";
import { RepBars } from "./charts/Sparkline";
import { NoteForm } from "./NoteForm";
import { Badge, Card, CardHeader, DepthLadder, cx } from "./ui";

/**
 * Session → set → raw signal. Shared by clinician and patient views; the
 * audience prop switches vocabulary and how much is shown by default.
 */
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
  audience: "clinician" | "patient";
  rawPreview?: SignalData | null;
}) {
  const plain = audience === "patient";
  const idx = sessions.findIndex((s) => s.id === session.id);
  const prev = sessions[idx - 1];
  const next = sessions[idx + 1];
  const recs = recordings.filter((r) => r.sessionId === session.id);
  const selected = recs.find((r) => r.id === selectedId) ?? recs.reduce((a, b) => (b.metrics.peakEnvelope > a.metrics.peakEnvelope ? b : a), recs[0]);
  const prevRecs = prev ? recordings.filter((r) => r.sessionId === prev.id && r.exercise === selected?.exercise) : [];
  const prevBest = prevRecs.length ? Math.max(...prevRecs.map((r) => r.metrics.peakEnvelope)) : null;
  const clin = clinicianById(session.clinicianId);
  const metricKeys: MetricKey[] = plain ? ["peakEnvelope", "meanEnvelope", "fatigueIndex"] : (["peakEnvelope", "meanEnvelope", "rms", "iemg", "medianFreqHz", "fatigueIndex"] as MetricKey[]).filter((k) => !selected || metricAvailable(selected, k));

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
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DepthLadder level={selectedId ? 3 : 1} />
          <nav className="ml-2 flex gap-1" aria-label="Session navigation">
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
      <div className="grid gap-4 md:grid-cols-2">
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
                      <div className="text-[12px] text-ink-2">{r.metrics.repsDetected} reps</div>
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
          <Card>
            <CardHeader
              eyebrow={`Set ${selected.setNumber} · ${fmtTime(selected.recordedAt)} · ${selected.durationS}s @ ${selected.sampleRateHz} Hz`}
              title={`${EXERCISES[selected.exercise].name} — ${plain ? "your muscle signal" : "signal"}`}
              subtitle={
                plain
                  ? "Each shaded band is one repetition. Taller = your muscle worked harder."
                  : "Shaded bands = detected contractions. Drag to zoom; cursor is synced across channels."
              }
            />
            <div className="pt-4">
              <SignalViewer key={selected.id} recordingId={selected.id} access={access} audience={audience} />
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title={plain ? "What this set shows" : "Set metrics"} />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 pb-5 pt-4 sm:grid-cols-3 sm:px-6">
                {metricKeys.map((k) => (
                  <div key={k}>
                    <dt className="text-[12px] text-ink-2" title={METRICS[k].help}>
                      {plain ? METRICS[k].plain : METRICS[k].label}
                    </dt>
                    <dd className="tabular mt-0.5 text-xl font-semibold">
                      {(selected.metrics[k] as number).toFixed(METRICS[k].digits)}
                      <span className="ml-1 text-[13px] font-normal text-ink-3">{METRICS[k].unit}</span>
                    </dd>
                    {!plain && <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{METRICS[k].help}</p>}
                  </div>
                ))}
              </dl>
              {prevBest != null && (
                <p className="border-t border-line px-5 py-3 text-[13px] text-ink-2 sm:px-6">
                  {plain ? "Compared with your previous session" : "Previous session best"}:{" "}
                  <b className="text-ink tabular">{prevBest.toFixed(2)} mV</b>
                  {" → "}
                  <b className="text-ink tabular">{selected.metrics.peakEnvelope.toFixed(2)} mV</b> (
                  {(((selected.metrics.peakEnvelope - prevBest) / prevBest) * 100).toFixed(0)}%)
                </p>
              )}
            </Card>
            <Card>
              <CardHeader title={plain ? "Each repetition" : "Per-rep peak"} subtitle={plain ? "Did your effort hold up to the end?" : "Envelope maximum per contraction"} />
              <div className="px-5 pb-5 pt-4 sm:px-6">
                <RepBars values={selected.metrics.repPeaks} height={88} />
                {!plain && selected.metrics.repMedianFreq.length > 0 && metricAvailable(selected, "medianFreqHz") && (
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
                  <a href={`/api/export/csv?rid=${selected.id}&${access}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[13px] font-medium text-brand hover:bg-brand-tint">
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
                    ? `${selected.capture?.transport === "demo" ? "simulated demo sensor, recorded live" : "live Bluetooth recording"} from ${selected.deviceId}${selected.capture ? ` (${selected.capture.observedRateHz} Hz received, resampled to ${selected.sampleRateHz} Hz)` : ""}`
                    : `device ${selected.deviceId}`} · units {selected.units} ·
                recording id <span className="font-mono">{selected.id}</span>
              </p>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader title={plain ? "Notes from your clinician" : "Session notes"} />
        <div className="px-5 pb-5 pt-3 sm:px-6">
          {session.notes ? <p className="whitespace-pre-line text-sm">{session.notes}</p> : <p className="text-sm text-ink-2">No notes for this session.</p>}
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
