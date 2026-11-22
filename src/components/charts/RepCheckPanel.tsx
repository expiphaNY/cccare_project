// =============================================================================
// RepCheckPanel.tsx : ARM MOVEMENT, REP CROSS-CHECK AND SHAKINESS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The lower half of a set page. Three parts:
//     - the accelerometer chart (cleaned, with a switch to show the readings exactly as the chip sent them),
//     - the rep cross-check: muscle reps against arm reps, with a table of every rep and which sensor saw it,
//     - the shakiness section: how strong the 3 to 12 per second shake is, when, and how rhythmic.
//   It re-runs the same functions the save route ran (lib/motion.ts, lib/rep-verify.ts and lib/tremor.ts), so what is
//   drawn is what was stored.
// =============================================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import { Activity, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ClientSignal } from "@/lib/client-signal";
import { resample } from "@/lib/client-signal";
import { MOTION_LOWPASS_HZ } from "@/lib/motion";
import { REP_STATUS, verifyReps } from "@/lib/rep-verify";
import { PHASE, TREMOR_LEVELS, analyzeTremor, tremorLevel } from "@/lib/tremor";
import type { TremorMetrics } from "@/lib/types";
import { RepBars } from "./Sparkline";
import { Segmented } from "../Segmented";
import { Badge, cx } from "../ui";
import { AXIS, UChart, fmtNum } from "./UChart";

const MOTION_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];
const BAND = {
  both: { fill: "rgba(27,175,122,0.13)", edge: "rgba(27,175,122,0.85)", label: "Verified (both sensors)" },
  emg: { fill: "rgba(237,161,0,0.16)", edge: "rgba(200,130,0,0.9)", label: "EMG only (no matching movement)" },
  motion: { fill: "rgba(135,84,214,0.14)", edge: "rgba(120,70,200,0.9)", label: "Movement only (no matching EMG)" },
} as const;

/**
 * The arm-movement part of the set page: the accelerometer chart, the rep cross-check
 * (muscle reps against arm reps) and the shakiness section.
 * It re-runs the exact functions the save route ran (cleaning in lib/motion.ts, counting
 * in lib/rep-verify.ts), so the bands drawn here are what the stored rep check counted.
 */
export function MotionPanel({ data, range, plain, stored }: { data: ClientSignal; range: [number, number] | null; plain: boolean; stored?: TremorMetrics }) {
  const v = useMemo(() => verifyReps(data.envelope, data.fs, data.motion), [data]);
  const tremor = useMemo(() => analyzeTremor(data.motion!, data.fs, v.motion!), [data, v]);
  const pm = v.motion!;
  const check = v.check;
  // Show the cleaned accelerometer or the readings exactly as the chip sent them.
  const [trace, setTrace] = useState<"smooth" | "raw">("smooth");
  const st = REP_STATUS[check.status];

  // Common ~50 Hz grid for the overlay.
  const x = useMemo(() => {
    const a = new Float64Array(pm.angle.length);
    for (let i = 0; i < a.length; i++) a[i] = i / pm.fs;
    return a;
  }, [pm]);
  const envNorm = useMemo(() => {
    const e = resample(data.envelope, data.fs, pm.fs).y;
    let mx = 0;
    for (const q of e) mx = Math.max(mx, q);
    const out = new Float32Array(x.length);
    for (let i = 0; i < out.length; i++) out[i] = mx ? (e[Math.min(i, e.length - 1)] / mx) * 100 : 0;
    return out;
  }, [data, pm.fs, x.length]);

  return (
    <div className="mt-4 space-y-4">
      {/* Accelerometer */}
      <div>
        <div className="flex flex-wrap items-center gap-3 px-3 pb-1 text-[12px] text-ink-2">
          <span className="font-medium text-ink">{plain ? "Arm movement" : "Accelerometer"}</span>
          {["X", "Y", "Z"].map((l, i) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: MOTION_COLORS[i] }} aria-hidden /> {l}
            </span>
          ))}
          <span className="text-ink-3">
            {trace === "smooth"
              ? `despiked (median) + ${MOTION_LOWPASS_HZ} Hz zero-phase low-pass${pm.spikesRemoved ? ` · ${pm.spikesRemoved} glitch${pm.spikesRemoved === 1 ? "" : "es"} removed` : ""}`
              : "as received, unfiltered"}
          </span>
          <span className="ml-auto">
            <Segmented
              label="Accelerometer trace"
              size="sm"
              value={trace}
              onChange={setTrace}
              options={[
                { value: "smooth", label: "Smoothed" },
                { value: "raw", label: "Raw" },
              ]}
            />
          </span>
        </div>
        <AxisChart id={data.id} x={x} series={trace === "smooth" ? pm.smooth : pm.raw} range={range} duration={data.n / data.fs} />
      </div>

      {/* Cross-check */}
      <div className="mx-3 rounded-2xl border border-line">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[14px] font-semibold">Rep cross-check</span>
          <Badge tone={st.tone}>
            {check.status === "verified" ? <CircleCheck className="size-3.5" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}
            {st.label}
          </Badge>
          <span className="text-[12px] text-ink-2">{st.help}</span>
        </div>
        <dl className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-5">
          <Stat k="EMG reps" v={String(check.emgReps)} />
          <Stat k="Movement reps" v={String(check.motionReps)} />
          <Stat k="Verified" v={`${check.verifiedReps}`} tone={check.status === "verified" ? "good" : undefined} />
          <Stat k="Agreement" v={`${Math.round(check.agreement * 100)}%`} help="2 × verified ÷ (EMG reps + movement reps)" />
          <Stat
            k={plain ? "Range per rep" : "Mean ROM · onset"}
            v={`${check.meanRomDeg ?? "–"}°${!plain && check.meanLagMs != null ? ` · ${check.meanLagMs > 0 ? "+" : ""}${check.meanLagMs} ms` : ""}`}
            help="Arm rotation per rep (degrees from rest). Onset = EMG onset minus movement onset; negative means the muscle fired first."
          />
        </dl>
        <div className="flex flex-wrap items-center gap-3 px-4 pb-1 text-[12px] text-ink-2">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded bg-[#0b63ce]" aria-hidden /> EMG envelope (% of set peak)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded bg-[#eb6834]" aria-hidden /> Arm angle (°)
          </span>
          {(["both", "emg", "motion"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: BAND[k].fill, outline: `1px solid ${BAND[k].edge}` }} aria-hidden /> {BAND[k].label}
            </span>
          ))}
        </div>
        <OverlayChart id={data.id} x={x} env={envNorm} angle={pm.angle} reps={check.reps} range={range} duration={data.n / data.fs} />
        <div className="max-h-56 overflow-auto border-t border-line">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-white text-left text-ink-2">
              <tr>
                <th className="px-4 py-2 font-medium">Rep</th>
                <th className="px-2 py-2 font-medium">Time</th>
                <th className="px-2 py-2 font-medium">Seen by</th>
                <th className="px-2 py-2 text-right font-medium">EMG peak</th>
                <th className="px-2 py-2 text-right font-medium">ROM</th>
                <th className="px-4 py-2 text-right font-medium">Onset offset</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {check.reps.map((r, i) => (
                <tr key={i} className="border-t border-line/70">
                  <td className="px-4 py-1.5">{i + 1}</td>
                  <td className="px-2 py-1.5 text-ink-2">
                    {r.start.toFixed(1)}–{r.end.toFixed(1)} s
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full" style={{ background: BAND[r.source].edge }} aria-hidden />
                      {r.source === "both" ? "Both" : r.source === "emg" ? "EMG only" : "Movement only"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{r.emgPeak != null ? `${fmtNum(r.emgPeak, 3)} mV` : "–"}</td>
                  <td className="px-2 py-1.5 text-right">{r.romDeg != null ? `${Math.round(r.romDeg)}°` : "–"}</td>
                  <td className="px-4 py-1.5 text-right">{r.lagMs != null ? `${r.lagMs > 0 ? "+" : ""}${r.lagMs} ms` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex gap-2 border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          EMG reps: robust-threshold hysteresis on the envelope. Movement reps: arm angle from the resting orientation, counted above 50 % of the
          set’s range (≥ 8°, ≥ 0.5 s). A rep is verified when the two overlap in time. EMG-only reps often mean a partial or isometric rep;
          movement-only reps suggest momentum (swinging) or poor electrode contact.
        </p>
      </div>

      <TremorSection id={data.id} x={x} analysis={tremor} stored={stored} range={range} duration={data.n / data.fs} />
    </div>
  );
}

const LEVEL_TONE = { low: "good", mild: "neutral", moderate: "warn", marked: "bad" } as const;

/** Shakiness: 3–12 Hz accelerometer tremor, read mainly while the arm holds still at the top. */
function TremorSection({
  id,
  x,
  analysis,
  stored,
  range,
  duration,
}: {
  id: string;
  x: Float64Array;
  analysis: ReturnType<typeof analyzeTremor>;
  stored?: TremorMetrics;
  range: [number, number] | null;
  duration: number;
}) {
  // Stored numbers were computed with the sensor's real packet rate; the chart is recomputed here.
  const t = stored ?? analysis.metrics;
  const lvl = tremorLevel(t.headlineMg);
  const band = t.peakHz == null ? null : t.peakHz >= 7.75 ? "physiological" : "slow";
  return (
    <div className="mx-3 rounded-2xl border border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold">
          <Activity className="size-4 text-brand" aria-hidden /> Shakiness
        </span>
        <Badge tone={LEVEL_TONE[t.level]}>{lvl.label}</Badge>
        <span className="text-[12px] text-ink-2">{lvl.help}</span>
      </div>
      {!t.reliable && (
        <p className="mx-4 mt-3 rounded-xl bg-warn-soft px-3 py-2 text-[12px] text-warn" role="note">
          The accelerometer sent about {Math.round(t.effectiveHz)} readings a second, so shake faster than {Math.floor(t.effectiveHz / 2)} Hz
          can’t be measured. Treat these numbers as a lower bound.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-5">
        <Stat
          k={t.headlineFrom === "hold" ? "At hold (postural)" : "Whole set"}
          v={`${t.headlineMg} mg`}
          help="RMS of 3–12 Hz acceleration while the arm holds the weight still at the top. The most reliable shakiness number: no curl motion mixed in."
        />
        <Stat
          k="Rhythm"
          v={t.peakHz != null ? `${t.peakHz} Hz` : "–"}
          help={`Dominant shake frequency. ${t.rhythmicityPct}% of the band’s power is within ±1 Hz of it.`}
        />
        <Stat k="Off-axis" v={`${t.offAxisRmsMg} mg`} help="Shake along the elbow’s rotation axis, which the curl itself barely moves: a clean cross-check that the shake is real." />
        <Stat k="At rest" v={t.restRmsMg != null ? `${t.restRmsMg} mg` : "–"} help="Arm relaxed at the bottom (rest tremor)." />
        <Stat
          k="Over the set"
          v={t.fatigueChangePct != null ? `${t.fatigueChangePct > 0 ? "+" : ""}${Math.round(t.fatigueChangePct)}%` : "–"}
          help="Hold shake in the last reps vs the first reps. Rising = shakier as the muscle tires."
        />
      </dl>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-1 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 rounded bg-[#7a4fd0]" aria-hidden /> Shake, 0.5 s RMS (mg)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-[rgba(122,79,208,0.14)]" aria-hidden /> Hold at the top
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 rounded border-t border-dashed border-ink-3" aria-hidden /> While moving (includes some curl motion)
        </span>
      </div>
      <TremorChart id={id} x={x} analysis={analysis} range={range} duration={duration} />
      <div className="grid gap-4 border-t border-line px-4 py-3 sm:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="mb-1.5 text-[12px] text-ink-2">Hold shake per rep (mg)</p>
          {t.perRepMg.length ? <RepBars values={t.perRepMg} height={56} unit="mg" digits={1} /> : <p className="text-[12px] text-ink-3">No reps with a hold at the top.</p>}
        </div>
        <p className="flex gap-2 text-[12px] leading-relaxed text-ink-2">
          <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
          <span>
            {!t.rhythmic
              ? "No clear rhythm: mostly irregular jitter or sensor noise rather than tremor."
              : band === "physiological"
                ? `Rhythmic shake at ${t.peakHz} Hz, in the physiological range (8–12 Hz): normal tremor, amplified by effort, load and fatigue.`
                : `Rhythmic shake at ${t.peakHz} Hz, slower than physiological tremor. Slow tremor (4–7 Hz) is typical of neurological causes; worth noting if it persists across sessions.`}{" "}
            Levels use hold RMS: steady &lt; {TREMOR_LEVELS[0].max} mg, mild &lt; {TREMOR_LEVELS[1].max} mg, moderate &lt; {TREMOR_LEVELS[2].max} mg.
            Not a diagnosis. {t.glitchesRemoved ? `${t.glitchesRemoved} glitch reading${t.glitchesRemoved === 1 ? "" : "s"} ignored.` : ""}
          </span>
        </p>
      </div>
    </div>
  );
}

function TremorChart({
  id,
  x,
  analysis,
  range,
  duration,
}: {
  id: string;
  x: Float64Array;
  analysis: ReturnType<typeof analyzeTremor>;
  range: [number, number] | null;
  duration: number;
}) {
  const plot = useRef<uPlot | null>(null);
  const rangeRef = useRange(plot, range, duration);
  const { rmsMg, phase } = analysis.series;
  const aligned = useMemo(() => {
    const n = Math.min(x.length, rmsMg.length);
    const still: (number | null)[] = new Array(n);
    const moving: (number | null)[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const m = phase[i] === PHASE.moving;
      // Overlap one sample so the two lines join.
      still[i] = !m || (i > 0 && phase[i - 1] !== PHASE.moving) ? rmsMg[i] : null;
      moving[i] = m || (i > 0 && phase[i - 1] === PHASE.moving) ? rmsMg[i] : null;
    }
    return [x.subarray(0, n), still, moving] as unknown as uPlot.AlignedData;
  }, [x, rmsMg, phase]);
  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      padding: [10, 12, 0, 0],
      cursor: { sync: { key: `sig-${id}`, setSeries: false }, points: { show: false }, y: false, drag: { x: false, y: false } },
      scales: { x: { time: false }, y: { range: (_u, _mn, mx) => [0, Math.max(20, (mx ?? 0) * 1.1)] } },
      axes: [
        { ...AXIS, values: (_u, v) => v.map((s) => `${s.toFixed(s < 10 ? 1 : 0)} s`) },
        { ...AXIS, size: 56, values: (_u, v) => v.map((n) => n.toFixed(0)), label: "Shake (mg)", labelSize: 16, labelFont: AXIS.font },
      ],
      series: [
        {},
        { label: "Shake", stroke: "#7a4fd0", width: 2, points: { show: false } },
        { label: "Moving", stroke: "rgba(92,107,130,0.55)", width: 1.25, dash: [4, 4], points: { show: false } },
      ],
      legend: { show: false },
      hooks: {
        drawAxes: [
          (u: uPlot) => {
            const { ctx, bbox } = u;
            const dpr = devicePixelRatio || 1;
            ctx.save();
            // Hold windows.
            ctx.fillStyle = "rgba(122,79,208,0.10)";
            const fs = analysis.series.fs;
            let i = 0;
            while (i < phase.length) {
              if (phase[i] !== PHASE.hold) {
                i++;
                continue;
              }
              let j = i;
              while (j < phase.length && phase[j] === PHASE.hold) j++;
              const x0 = Math.max(bbox.left, u.valToPos(i / fs, "x", true));
              const x1 = Math.min(bbox.left + bbox.width, u.valToPos(j / fs, "x", true));
              if (x1 > x0) ctx.fillRect(x0, bbox.top, x1 - x0, bbox.height);
              i = j;
            }
            // Level thresholds.
            ctx.setLineDash([3 * dpr, 4 * dpr]);
            ctx.lineWidth = dpr;
            ctx.font = `${10 * dpr}px -apple-system, system-ui, sans-serif`;
            ctx.textAlign = "right";
            for (const l of TREMOR_LEVELS.slice(0, 3)) {
              if (l.max > (u.scales.y.max ?? 0)) continue;
              const y = u.valToPos(l.max, "y", true);
              ctx.strokeStyle = "rgba(92,107,130,0.45)";
              ctx.beginPath();
              ctx.moveTo(bbox.left, y);
              ctx.lineTo(bbox.left + bbox.width, y);
              ctx.stroke();
              ctx.fillStyle = "rgba(92,107,130,0.9)";
              ctx.fillText(`${l.max} mg`, bbox.left + bbox.width - 4 * dpr, y - 3 * dpr);
            }
            ctx.restore();
          },
        ],
      },
    }),
    [id, phase, analysis.series.fs],
  );
  const tooltip = useMemo(
    () => (u: uPlot, idx: number) => {
      const v = (u.data[1][idx] ?? u.data[2][idx]) as number | null;
      return v == null ? null : `<div style="color:#5c6b82">${(u.data[0][idx] as number).toFixed(2)} s</div><div><span style="color:#7a4fd0">●</span> Shake <b>${v.toFixed(1)} mg</b></div>`;
    },
    [],
  );
  return (
    <UChart
      options={options}
      data={aligned}
      height={150}
      tooltip={tooltip}
      ariaLabel="Shakiness (3 to 12 hertz acceleration) over time, with holds at the top of each curl shaded"
      onCreate={(u) => {
        plot.current = u;
        const r = rangeRef.current;
        if (r) u.setScale("x", { min: r[0], max: r[1] });
      }}
    />
  );
}

function Stat({ k, v, help, tone }: { k: string; v: string; help?: string; tone?: "good" }) {
  return (
    <div title={help}>
      <dt className="text-[12px] text-ink-2">{k}</dt>
      <dd className={cx("tabular text-[17px] font-semibold", tone === "good" && "text-good")}>{v}</dd>
    </div>
  );
}

function useRange(plot: React.RefObject<uPlot | null>, range: [number, number] | null, duration: number) {
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
    const u = plot.current;
    if (u?.root.isConnected) u.setScale("x", range ? { min: range[0], max: range[1] } : { min: 0, max: duration });
  }, [plot, range, duration]);
  return rangeRef;
}

function AxisChart({
  id,
  x,
  series,
  range,
  duration,
}: {
  id: string;
  x: Float64Array;
  series: { x: Float32Array; y: Float32Array; z: Float32Array };
  range: [number, number] | null;
  duration: number;
}) {
  const plot = useRef<uPlot | null>(null);
  const rangeRef = useRange(plot, range, duration);
  const aligned = useMemo(() => [x, series.x, series.y, series.z] as unknown as uPlot.AlignedData, [x, series]);
  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      padding: [8, 12, 0, 0],
      cursor: { sync: { key: `sig-${id}`, setSeries: false }, points: { show: false }, y: false, drag: { x: false, y: false } },
      scales: { x: { time: false } },
      axes: [
        { ...AXIS, values: (_u, v) => v.map((s) => `${s.toFixed(s < 10 ? 1 : 0)} s`) },
        { ...AXIS, size: 56, values: (_u, v) => v.map((n) => n.toFixed(1)), label: "Accel (g)", labelSize: 16, labelFont: AXIS.font },
      ],
      series: [{}, ...["X", "Y", "Z"].map((l, i) => ({ label: l, stroke: MOTION_COLORS[i], width: 1.5, points: { show: false } }))],
      legend: { show: false },
    }),
    [id],
  );
  const tooltip = useMemo(
    () => (u: uPlot, idx: number) =>
      `<div style="color:#5c6b82">${(u.data[0][idx] as number).toFixed(2)} s</div>` +
      ["X", "Y", "Z"].map((l, i) => `<div><span style="color:${MOTION_COLORS[i]}">●</span> ${l} <b>${fmtNum(u.data[i + 1][idx] as number, 2)} g</b></div>`).join(""),
    [],
  );
  return (
    <UChart
      options={options}
      data={aligned}
      height={150}
      tooltip={tooltip}
      ariaLabel="Accelerometer x, y and z over time"
      onCreate={(u) => {
        plot.current = u;
        const r = rangeRef.current;
        if (r) u.setScale("x", { min: r[0], max: r[1] });
      }}
    />
  );
}

function OverlayChart({
  id,
  x,
  env,
  angle,
  reps,
  range,
  duration,
}: {
  id: string;
  x: Float64Array;
  env: Float32Array;
  angle: Float32Array;
  reps: { start: number; end: number; source: keyof typeof BAND }[];
  range: [number, number] | null;
  duration: number;
}) {
  const plot = useRef<uPlot | null>(null);
  const rangeRef = useRange(plot, range, duration);
  const aligned = useMemo(() => [x, env, angle] as unknown as uPlot.AlignedData, [x, env, angle]);
  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      padding: [10, 8, 0, 0],
      cursor: { sync: { key: `sig-${id}`, setSeries: false }, points: { show: false }, y: false, drag: { x: false, y: false } },
      scales: { x: { time: false }, pct: { range: [0, 110] }, deg: { range: (_u, _mn, mx) => [0, Math.max(30, (mx ?? 0) * 1.1)] } },
      axes: [
        { ...AXIS, values: (_u, v) => v.map((s) => `${s.toFixed(s < 10 ? 1 : 0)} s`) },
        { ...AXIS, scale: "pct", size: 56, values: (_u, v) => v.map((n) => `${n.toFixed(0)}%`), label: "EMG", labelSize: 16, labelFont: AXIS.font },
        { ...AXIS, scale: "deg", side: 1, size: 48, grid: { show: false }, values: (_u, v) => v.map((n) => `${n.toFixed(0)}°`) },
      ],
      series: [
        {},
        { label: "EMG", scale: "pct", stroke: "#0b63ce", width: 2, fill: "rgba(11,99,206,0.06)", points: { show: false } },
        { label: "Arm angle", scale: "deg", stroke: "#eb6834", width: 2, points: { show: false } },
      ],
      legend: { show: false },
      hooks: {
        drawAxes: [
          (u: uPlot) => {
            const { ctx, bbox } = u;
            const dpr = devicePixelRatio || 1;
            ctx.save();
            for (const r of reps) {
              const x0 = Math.max(bbox.left, u.valToPos(r.start, "x", true));
              const x1 = Math.min(bbox.left + bbox.width, u.valToPos(r.end, "x", true));
              if (x1 <= x0) continue;
              ctx.fillStyle = BAND[r.source].fill;
              ctx.fillRect(x0, bbox.top, x1 - x0, bbox.height);
              ctx.fillStyle = BAND[r.source].edge;
              ctx.fillRect(x0, bbox.top, x1 - x0, 3 * dpr);
            }
            ctx.restore();
          },
        ],
      },
    }),
    [id, reps],
  );
  const tooltip = useMemo(
    () => (u: uPlot, idx: number) =>
      `<div style="color:#5c6b82">${(u.data[0][idx] as number).toFixed(2)} s</div>` +
      `<div><span style="color:#0b63ce">●</span> EMG <b>${Math.round(u.data[1][idx] as number)}%</b></div>` +
      `<div><span style="color:#eb6834">●</span> Arm <b>${Math.round(u.data[2][idx] as number)}°</b></div>`,
    [],
  );
  return (
    <UChart
      options={options}
      data={aligned}
      height={190}
      tooltip={tooltip}
      ariaLabel="EMG envelope and arm angle overlaid, with repetitions coloured by whether both sensors agree"
      onCreate={(u) => {
        plot.current = u;
        const r = rangeRef.current;
        if (r) u.setScale("x", { min: r[0], max: r[1] });
      }}
    />
  );
}
