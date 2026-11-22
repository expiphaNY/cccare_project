// =============================================================================
// LoadCard.tsx : WEIGHT AND SHAKINESS CARDS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Two cards for the patient overview: the weights used across sessions (LoadCard), and how shaky the arm is at each weight (TremorCard).
// =============================================================================

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Activity, ArrowRight, CircleCheck, Dumbbell, TriangleAlert } from "lucide-react";
import { setPrescribedLoadAction } from "@/app/actions";
import { DEMO, DEMO_MSG } from "@/lib/demo";
import { tremorLevel } from "@/lib/tremor";
import { fmtLoad, type Load, type WeightSettings } from "@/lib/types";
import { Card, CardHeader, btn, cx } from "./ui";

export interface LoadPoint {
  sessionId: string;
  date: string;
  /** Heaviest weight used in the session (kg, for the chart). */
  kg: number;
  label: string;
  /** Verified reps across the session's sets (null = no accelerometer). */
  verified: number | null;
  emg: number;
  agreementPct: number | null;
}

/** Prescribed working weight, weight per session and rep-verification quality. */
export function LoadCard({
  patientId,
  prescribed,
  weights,
  points,
  baseHref,
}: {
  patientId: string;
  prescribed?: Load;
  weights: WeightSettings;
  points: LoadPoint[];
  baseHref: string;
}) {
  const recent = points.slice(-8);
  const maxKg = Math.max(0.5, ...recent.map((p) => p.kg));
  const withMotion = points.slice(-5).filter((p) => p.agreementPct != null);
  const agree = withMotion.length ? Math.floor(withMotion.reduce((t, p) => t + p.agreementPct!, 0) / withMotion.length) : null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Dumbbell className="size-[18px] text-brand" aria-hidden /> Load & rep quality
          </span>
        }
        subtitle="Weight lifted per session (heaviest set) and how many reps both EMG and the accelerometer confirmed."
      />
      <div className="grid gap-6 px-5 pb-5 pt-4 sm:px-6 lg:grid-cols-[220px_1fr_200px]">
        <PrescribedForm patientId={patientId} prescribed={prescribed} weights={weights} />

        <div>
          {recent.length ? (
            <ol className="flex h-36 items-end gap-2" aria-label="Weight per session">
              {recent.map((p) => (
                <li key={p.sessionId} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-[11px] font-medium tabular text-ink">{p.label}</span>
                  <Link
                    href={`${baseHref}/sessions/${p.sessionId}`}
                    className="pressable w-full max-w-10 rounded-t-lg bg-brand/80 hover:bg-brand"
                    style={{ height: `${Math.max(6, (p.kg / maxKg) * 84)}px` }}
                    title={`${p.date}: ${p.label}, ${p.verified ?? p.emg} reps${p.verified != null ? " verified" : " (EMG only)"}`}
                    aria-label={`${p.date}: ${p.label}`}
                  />
                  <span
                    className={cx(
                      "inline-flex items-center gap-0.5 text-[11px] tabular",
                      p.agreementPct == null ? "text-ink-3" : p.agreementPct >= 100 ? "text-good" : p.agreementPct >= 75 ? "text-warn" : "text-bad",
                    )}
                  >
                    {p.agreementPct != null && (p.agreementPct >= 100 ? <CircleCheck className="size-3" aria-hidden /> : <TriangleAlert className="size-3" aria-hidden />)}
                    {p.verified ?? p.emg}
                  </span>
                  <span className="truncate text-[10px] text-ink-3">{p.date.slice(5)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-2">No weights recorded yet. Pick a weight in New measurement and it is saved with each set.</p>
          )}
          <p className="mt-2 text-[11px] text-ink-3">Bar = weight · number below = reps (✓ all verified, ⚠ sensors disagreed on some).</p>
        </div>

        <div className="rounded-2xl bg-canvas p-3.5">
          <div className="text-[12px] text-ink-2">Reps verified, last 5 sessions</div>
          <div className="display mt-1 text-[28px] font-semibold tabular leading-none">{agree != null ? `${agree}%` : "–"}</div>
          <p className="mt-2 text-[12px] leading-snug text-ink-2">
            {agree == null
              ? "No accelerometer data yet."
              : agree >= 95
                ? "EMG and movement agree: rep counts are reliable."
                : "Some reps were seen by only one sensor. Open a session to see which."}
          </p>
          <Link href={`${baseHref}/sessions`} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            Sessions <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}

function PrescribedForm({ patientId, prescribed, weights }: { patientId: string; prescribed?: Load; weights: WeightSettings }) {
  const [value, setValue] = useState(String(prescribed && prescribed.unit === weights.unit ? prescribed.value : (weights.options.find((x) => x > 0) ?? 0)));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          if (DEMO) return setMsg({ ok: false, text: DEMO_MSG });
          const r = await setPrescribedLoadAction(patientId, Number(value), weights.unit);
          setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
        });
      }}
    >
      <div className="text-[12px] text-ink-2">Prescribed working weight</div>
      <div className="display mt-1 text-[28px] font-semibold leading-none">{fmtLoad(prescribed)}</div>
      <p className="mt-1 text-[12px] text-ink-3">New measurements start at this weight.</p>
      <div className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor={`pl-${patientId}`}>
          New working weight
        </label>
        <select
          id={`pl-${patientId}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-9 flex-1 rounded-xl border border-line-strong bg-white px-2 text-sm"
        >
          {weights.options.map((w) => (
            <option key={w} value={w}>
              {w === 0 ? "No weight" : `${w} ${weights.unit}`}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className={cx(btn.secondary, btn.small, "min-h-9")}>
          {pending ? "Saving…" : "Set"}
        </button>
      </div>
      {msg && <p className={cx("mt-1.5 text-[12px]", msg.ok ? "text-good" : "text-bad")}>{msg.text}</p>}
    </form>
  );
}

export interface TremorPoint {
  sessionId: string;
  date: string;
  /** Mean hold shake across the session's sets (mg). */
  mg: number;
  peakHz: number | null;
  rhythmic: boolean;
  loadLabel: string | null;
}

const LEVEL_BAR = { low: "bg-good/70", mild: "bg-brand/70", moderate: "bg-warn/80", marked: "bg-bad/80" } as const;

/** Shakiness per session and by weight. */
export function TremorCard({ points, byLoad, baseHref }: { points: TremorPoint[]; byLoad: { label: string; kg: number; mg: number; sets: number }[]; baseHref: string }) {
  const recent = points.slice(-10);
  if (!recent.length) return null;
  const max = Math.max(20, ...recent.map((p) => p.mg)) * 1.1;
  const first = points.slice(0, 3);
  const last = points.slice(-3);
  const avg = (xs: TremorPoint[]) => xs.reduce((s, p) => s + p.mg, 0) / xs.length;
  const change = points.length >= 4 ? Math.round((avg(last) / avg(first) - 1) * 100) : null;
  const latest = points[points.length - 1];
  const lvl = tremorLevel(latest.mg);
  const hz = latest.rhythmic ? latest.peakHz : null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Activity className="size-[18px] text-brand" aria-hidden /> Shakiness
          </span>
        }
        subtitle="3–12 Hz shake from the accelerometer while the weight is held at the top of each curl (mean of the session’s sets)."
      />
      <div className="grid gap-6 px-5 pb-5 pt-4 sm:px-6 lg:grid-cols-[220px_1fr_220px]">
        <div>
          <div className="text-[12px] text-ink-2">Latest session</div>
          <div className="display mt-1 text-[28px] font-semibold leading-none tabular">
            {latest.mg} <span className="text-[15px] font-normal text-ink-3">mg</span>
          </div>
          <p className="mt-1.5 text-[13px] font-medium">{lvl.label}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-2">
            {hz ? `Rhythmic at ${hz} Hz (${hz >= 7.75 ? "physiological range" : "slower than physiological tremor"}).` : "No clear rhythm."}
            {change != null && ` ${change > 0 ? "+" : ""}${change}% vs the first sessions.`}
          </p>
        </div>
        <div>
          <ol className="relative flex h-32 items-end gap-1.5" aria-label="Hold shake per session">
            {[5, 15, 50].filter((t) => t < max).map((t) => (
              <span key={t} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-strong" style={{ bottom: `${(t / max) * 100}%` }}>
                <span className="absolute -top-3.5 right-0 text-[10px] text-ink-3">{t}</span>
              </span>
            ))}
            {recent.map((p) => (
              <li key={p.sessionId} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
                <Link
                  href={`${baseHref}/sessions/${p.sessionId}`}
                  className={cx("pressable mx-auto w-full max-w-8 rounded-t-md", LEVEL_BAR[tremorLevel(p.mg).level])}
                  style={{ height: `${Math.max(3, (p.mg / max) * 100)}%` }}
                  title={`${p.date}: ${p.mg} mg${p.loadLabel ? ` at ${p.loadLabel}` : ""}${p.rhythmic && p.peakHz ? `, ${p.peakHz} Hz` : ""}`}
                  aria-label={`${p.date}: ${p.mg} mg`}
                />
              </li>
            ))}
          </ol>
          <div className="mt-1 flex gap-1.5">
            {recent.map((p) => (
              <span key={p.sessionId} className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-3">
                {p.date.slice(5)}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-3">Dashed lines: 5 / 15 / 50 mg (steady · mild · moderate · marked).</p>
        </div>
        <div className="rounded-2xl bg-canvas p-3.5">
          <div className="text-[12px] text-ink-2">Shake by weight</div>
          {byLoad.length ? (
            <table className="mt-1.5 w-full text-[13px] tabular">
              <tbody>
                {byLoad.map((b) => (
                  <tr key={b.label}>
                    <td className="py-0.5">{b.label}</td>
                    <td className="py-0.5 text-right font-semibold">{b.mg} mg</td>
                    <td className="py-0.5 pl-2 text-right text-[11px] text-ink-3">{b.sets} sets</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[12px] text-ink-3">No weights recorded.</p>
          )}
          {byLoad.length >= 2 && (
            <p className="mt-2 text-[12px] leading-snug text-ink-2">
              {byLoad[byLoad.length - 1].mg > byLoad[0].mg * 1.3
                ? "Shakier at heavier weights: check control before progressing."
                : byLoad[byLoad.length - 1].mg < byLoad[0].mg * 0.77
                  ? "Steadier at heavier weights: control has improved as the weight went up."
                  : "Shake stays similar as the weight goes up."}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
