"use client";

import { useEffect, useMemo, useState } from "react";
import type uPlot from "uplot";
import { Check, ChevronDown, Layers, Sparkles, X } from "lucide-react";
import { detectReps, fetchSignal, resample, type ClientSignal } from "@/lib/client-signal";
import { Segmented } from "./Segmented";
import { AXIS, SERIES_COLORS, UChart, fmtNum, swatch } from "./charts/UChart";
import { Card, Disclosure, cx } from "./ui";

export interface CompareRecording {
  id: string;
  sessionId: string;
  date: string;
  exercise: string;
  setNumber: number;
  peak: number;
  mean: number;
  mdf: number;
  fatigue: number;
}

type Channel = "envelope" | "rectified" | "raw";
type Mode = "rep" | "set";
type Scale = "abs" | "rel";

const MAX = 6;

const dateLabel = (iso: string, withYear = false) =>
  new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });

export function CompareTool({
  recordings,
  exercises,
  access,
  audience,
  initialExercise,
  initialIds,
}: {
  recordings: CompareRecording[];
  exercises: { key: string; name: string; muscle: string }[];
  access: string;
  audience: "clinician" | "patient" | "recipient";
  initialExercise?: string;
  initialIds?: string[];
}) {
  const plain = audience !== "clinician";
  const simple = audience === "patient";
  const [exercise, setExercise] = useState(initialExercise ?? exercises[0]?.key);
  const [selected, setSelected] = useState<{ id: string; slot: number }[]>(() =>
    (initialIds ?? []).slice(0, MAX).map((id, slot) => ({ id, slot })),
  );
  const [channel, setChannel] = useState<Channel>("envelope");
  const [mode, setMode] = useState<Mode>("rep");
  const [scale, setScale] = useState<Scale>("abs");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [signals, setSignals] = useState<Record<string, ClientSignal>>({});
  const [error, setError] = useState<string | null>(null);

  const recs = useMemo(() => recordings.filter((r) => r.exercise === exercise), [recordings, exercise]);
  const byId = useMemo(() => new Map(recordings.map((r) => [r.id, r])), [recordings]);

  // Sessions for this exercise with their sets, oldest first.
  const sessions = useMemo(() => {
    const m = new Map<string, CompareRecording[]>();
    for (const r of recs) m.set(r.sessionId, [...(m.get(r.sessionId) ?? []), r]);
    return [...m.entries()]
      .map(([sessionId, sets]) => ({
        sessionId,
        date: sets[0].date,
        sets: sets.sort((a, b) => a.setNumber - b.setNumber),
        best: sets.reduce((a, b) => (b.peak > a.peak ? b : a)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [recs]);

  // Selection is ordered by date so the table and legend read chronologically.
  const ordered = useMemo(
    () =>
      selected
        .map((s) => ({ ...s, rec: byId.get(s.id)! }))
        .filter((s) => s.rec && s.rec.exercise === exercise)
        .sort((a, b) => a.rec.date.localeCompare(b.rec.date) || a.rec.setNumber - b.rec.setNumber),
    [selected, byId, exercise],
  );

  useEffect(() => {
    let live = true;
    for (const s of ordered) {
      if (signals[s.id]) continue;
      fetchSignal(s.id, access, "compare").then(
        (sig) => live && setSignals((prev) => ({ ...prev, [s.id]: sig })),
        (e: Error) => live && setError(e.message),
      );
    }
    return () => {
      live = false;
    };
  }, [ordered, access, signals]);

  const toggle = (id: string) => {
    setError(null);
    setSelected((prev) => {
      if (prev.some((p) => p.id === id)) return prev.filter((p) => p.id !== id);
      if (prev.length >= MAX) return prev;
      const used = new Set(prev.map((p) => p.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      return [...prev, { id, slot }];
    });
  };
  const setMany = (ids: string[]) => setSelected(ids.slice(0, MAX).map((id, slot) => ({ id, slot })));

  const presets = [
    {
      label: plain ? "Start vs now" : "Baseline vs latest",
      ids: () => (sessions.length ? [sessions[0].best.id, sessions[sessions.length - 1].best.id] : []),
    },
    {
      label: plain ? "My journey" : "Progression (5 points)",
      ids: () => {
        const n = sessions.length;
        if (n <= 5) return sessions.map((s) => s.best.id);
        return [0, 1, 2, 3, 4].map((k) => sessions[Math.round((k * (n - 1)) / 4)].best.id);
      },
    },
    {
      label: plain ? "Best day vs now" : "Best vs latest",
      ids: () => {
        if (!sessions.length) return [];
        const best = sessions.reduce((a, b) => (b.best.peak > a.best.peak ? b : a));
        const last = sessions[sessions.length - 1];
        return best.sessionId === last.sessionId ? [last.best.id] : [best.best.id, last.best.id];
      },
    },
    {
      label: plain ? "Last two sessions" : "Last 2 sessions",
      ids: () => sessions.slice(-2).map((s) => s.best.id),
    },
  ];

  const ready = ordered.every((s) => signals[s.id]);
  const rawLocked = ordered.some((s) => signals[s.id] && !signals[s.id].raw) && channel !== "envelope";

  const chart = useMemo(() => {
    if (!ordered.length || !ready || rawLocked) return null;
    const curves = ordered.map((s) => {
      const sig = signals[s.id];
      const src = channel === "envelope" ? sig.envelope : channel === "rectified" ? sig.rectified! : sig.raw!;
      const outHz = channel === "raw" ? sig.fs : channel === "rectified" ? 200 : 100;
      if (mode === "set") {
        const r = channel === "raw" ? { y: src, fs: sig.fs } : resample(src, sig.fs, outHz);
        return { fs: r.fs, y: r.y, t0: 0 };
      }
      // Typical repetition: ensemble average of reps aligned on onset.
      const reps = detectReps(sig.envelope, sig.fs);
      const pre = 0.5;
      const len = 3.0;
      const n = Math.round(len * sig.fs);
      if (channel === "raw") {
        // Averaging raw EMG cancels it out — show the strongest rep instead.
        let best = reps[0];
        let bestPeak = -1;
        for (const r of reps) {
          let p = 0;
          for (let i = Math.floor(r.start * sig.fs); i < r.end * sig.fs; i++) p = Math.max(p, sig.envelope[i]);
          if (p > bestPeak) {
            bestPeak = p;
            best = r;
          }
        }
        const s0 = Math.max(0, Math.round((best.start - pre) * sig.fs));
        return { fs: sig.fs, y: src.subarray(s0, s0 + n), t0: -pre };
      }
      const acc = new Float32Array(n);
      let count = 0;
      for (const r of reps) {
        const s0 = Math.round((r.start - pre) * sig.fs);
        if (s0 < 0 || s0 + n > src.length) continue;
        for (let i = 0; i < n; i++) acc[i] += src[s0 + i];
        count++;
      }
      for (let i = 0; i < n; i++) acc[i] /= count || 1;
      const r = resample(acc, sig.fs, outHz);
      return { fs: r.fs, y: r.y, t0: -pre };
    });

    const fs = Math.min(...curves.map((c) => c.fs));
    const len = Math.max(...curves.map((c) => c.y.length * (fs / c.fs)));
    const t0 = curves[0].t0;
    const x = new Float64Array(Math.ceil(len));
    for (let i = 0; i < x.length; i++) x[i] = t0 + i / fs;
    const refPeak = (() => {
      let p = 0;
      for (const v of curves[0].y) p = Math.max(p, Math.abs(v));
      return p || 1;
    })();
    const ys = curves.map((c) => {
      const ratio = c.fs / fs;
      const out: (number | null)[] = new Array(x.length);
      for (let i = 0; i < x.length; i++) {
        const j = Math.round(i * ratio);
        const v = j < c.y.length ? c.y[j] : null;
        out[i] = v == null ? null : scale === "rel" ? (v / refPeak) * 100 : v;
      }
      return out;
    });
    return { data: [x, ...ys] as uPlot.AlignedData, refPeak };
  }, [ordered, ready, rawLocked, signals, channel, mode, scale]);

  const unit = scale === "rel" ? "%" : "mV";
  const slotsKey = ordered.map((s) => `${s.id}:${s.slot}`).join(",");

  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      padding: [12, 16, 0, 0],
      cursor: { points: { show: false }, drag: { x: true, y: false }, y: false },
      scales: { x: { time: false } },
      axes: [
        { ...AXIS, values: (_u, v) => v.map((s) => `${s.toFixed(1)} s`), label: mode === "rep" ? "Time from start of contraction" : "Time from start of set", labelSize: 18, labelFont: AXIS.font },
        { ...AXIS, size: 56, values: (_u, v) => v.map((n) => (unit === "%" ? n.toFixed(0) : n.toFixed(2))), label: unit === "%" ? "% of first selection's peak" : "mV", labelSize: 16, labelFont: AXIS.font },
      ],
      series: [
        {},
        ...ordered.map((s) => ({
          label: dateLabel(s.rec.date),
          stroke: SERIES_COLORS[s.slot],
          width: channel === "raw" ? 1 : 2,
          points: { show: false },
        })),
      ],
      legend: { show: false },
      focus: { alpha: 0.18 },
    }),
    // slotsKey captures the identity of the ordered selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotsKey, channel, mode, unit],
  );

  const [plot, setPlot] = useState<uPlot | null>(null);
  useEffect(() => {
    if (!plot) return;
    try {
      plot.setSeries(focus == null ? null : focus + 1, { focus: true });
    } catch {
      /* plot rebuilt */
    }
  }, [focus, plot]);

  const tooltip = useMemo(
    () => (u: uPlot, idx: number) => {
      const t = u.data[0][idx] as number;
      const rows = ordered
        .map((s, i) => {
          const v = u.data[i + 1]?.[idx];
          return v == null ? "" : `<div>${swatch(SERIES_COLORS[s.slot])}${dateLabel(s.rec.date)} · set ${s.rec.setNumber}: <b>${fmtNum(v as number, unit === "%" ? 0 : 3)} ${unit}</b></div>`;
        })
        .join("");
      return `<div style="color:#5c6b82;margin-bottom:3px">${t.toFixed(2)} s</div>${rows}`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotsKey, unit],
  );

  const first = ordered[0]?.rec;
  const last = ordered[ordered.length - 1]?.rec;
  const exName = exercises.find((e) => e.key === exercise)?.name ?? "";

const controls = (
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-3 sm:px-6">
            <Segmented
              label="Channel"
              size="sm"
              value={channel}
              onChange={setChannel}
              options={[
                { value: "envelope", label: plain ? "Effort (envelope)" : "Envelope" },
                { value: "rectified", label: "Rectified" },
                { value: "raw", label: plain ? "Raw signal" : "Raw EMG" },
              ]}
            />
            <Segmented
              label="Time window"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: "rep", label: plain ? "One typical rep" : "Average rep", title: "Reps aligned at onset and averaged (raw: strongest rep)" },
                { value: "set", label: "Whole set" },
              ]}
            />
            <Segmented
              label="Scale"
              size="sm"
              value={scale}
              onChange={setScale}
              options={[
                { value: "abs", label: "mV" },
                { value: "rel", label: plain ? "% of first" : "% of first", title: "Normalised to the earliest selection's peak" },
              ]}
            />
          </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      {/* ---------- Picker ---------- */}
      <Card className="flex max-h-none flex-col overflow-hidden lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)]">
        <div className="border-b border-line px-5 pb-4 pt-5">
          <div className="eyebrow mb-2">1 · {plain ? "Choose an exercise" : "Exercise"}</div>
          <div className="flex flex-col gap-1.5">
            {exercises.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => {
                  setExercise(e.key);
                  setSelected([]);
                }}
                className={cx(
                  "pressable flex min-h-11 cursor-pointer items-center justify-between rounded-xl border px-3 text-left text-sm",
                  exercise === e.key ? "border-brand bg-brand-tint" : "border-line hover:border-line-strong",
                )}
                aria-pressed={exercise === e.key}
              >
                <span>
                  <span className="font-medium">{e.name}</span>
                  <span className="block text-[12px] text-ink-3">{e.muscle}</span>
                </span>
                {exercise === e.key && <Check className="size-4 text-brand" aria-hidden />}
              </button>
            ))}
          </div>
        </div>

        <div className="border-b border-line px-5 py-4">
          <div className="eyebrow mb-2 flex items-center gap-1">
            <Sparkles className="size-3.5" aria-hidden /> {plain ? "Quick picks" : "Presets"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setMany(p.ids())}
                className="pressable min-h-8 cursor-pointer rounded-full border border-line-strong bg-white px-3 text-[13px] font-medium text-brand hover:bg-brand-tint"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <div className="eyebrow">
            2 · {plain ? "Pick the days to layer" : "Select recordings"} ({ordered.length}/{MAX})
          </div>
          {ordered.length > 0 && (
            <button type="button" onClick={() => setSelected([])} className="cursor-pointer text-[12px] font-medium text-brand hover:underline">
              Clear
            </button>
          )}
        </div>
        <ul className="max-h-72 flex-1 overflow-y-auto px-3 pb-3 lg:max-h-none" aria-label="Sessions">
          {[...sessions].reverse().map((s) => {
            const selInSession = ordered.filter((o) => o.rec.sessionId === s.sessionId);
            const isOpen = expanded === s.sessionId;
            const bestSel = selected.find((x) => x.id === s.best.id);
            return (
              <li key={s.sessionId} className="mb-1">
                <div
                  className={cx(
                    "flex items-center gap-2 rounded-xl px-2 py-1.5",
                    selInSession.length ? "bg-brand-tint" : "hover:bg-canvas",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggle(s.best.id)}
                    disabled={!bestSel && selected.length >= MAX}
                    aria-pressed={!!bestSel}
                    className="flex min-h-10 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={cx(
                        "flex size-5 shrink-0 items-center justify-center rounded-md border-2",
                        bestSel ? "border-transparent" : "border-line-strong bg-white",
                      )}
                      style={bestSel ? { background: SERIES_COLORS[bestSel.slot] } : undefined}
                    >
                      {bestSel && <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium tabular">{dateLabel(s.date, true)}</span>
                    </span>
                    <span className="w-16 text-right text-[12px] text-ink-2 tabular">{s.best.peak.toFixed(2)} mV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : s.sessionId)}
                    aria-expanded={isOpen}
                    aria-label={`Choose a specific set from ${dateLabel(s.date)}`}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-3 hover:bg-white hover:text-ink"
                  >
                    <ChevronDown className={cx("size-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
                  </button>
                </div>
                {isOpen && (
                  <div className="fade-in flex flex-wrap gap-1.5 py-2 pl-10 pr-2">
                    {s.sets.map((r) => {
                      const sel = selected.find((x) => x.id === r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => toggle(r.id)}
                          disabled={!sel && selected.length >= MAX}
                          aria-pressed={!!sel}
                          className={cx(
                            "pressable inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium disabled:opacity-50",
                            sel ? "border-transparent text-white" : "border-line-strong bg-white text-ink-2",
                          )}
                          style={sel ? { background: SERIES_COLORS[sel.slot] } : undefined}
                        >
                          Set {r.setNumber} · {r.peak.toFixed(2)}
                          {r.id === s.best.id && <span className="opacity-80">★</span>}
                        </button>
                      );
                    })}
                    <p className="w-full text-[11px] text-ink-3">★ = strongest set (used by default)</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* ---------- Chart + table ---------- */}
      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div>
              <div className="eyebrow mb-1 flex items-center gap-1">
                <Layers className="size-3.5" aria-hidden /> 3 · {plain ? "See the difference" : "Overlay"}
              </div>
              <h2 className="title text-[17px] font-semibold">
                {exName}
                {ordered.length > 1 && first && last && (
                  <span className="font-normal text-ink-2">
                    {" "}
                    · {dateLabel(first.date)} → {dateLabel(last.date)}
                  </span>
                )}
              </h2>
            </div>
          </div>
          {simple ? (
            <div className="px-5 pb-2 pt-1 sm:px-6">
              <Disclosure summary="Display options">
                {controls}
              </Disclosure>
            </div>
          ) : (
            controls
          )}

          {/* Legend: always present, chronological, hover to focus */}
          {ordered.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-5 pb-2 sm:px-6" role="list" aria-label="Legend">
              {ordered.map((s, i) => (
                <span
                  key={s.id}
                  role="listitem"
                  onMouseEnter={() => setFocus(i)}
                  onMouseLeave={() => setFocus(null)}
                  className="inline-flex min-h-8 items-center gap-2 rounded-full border border-line bg-white py-1 pl-2.5 pr-1 text-[13px]"
                >
                  <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: SERIES_COLORS[s.slot] }} />
                  <span className="font-medium tabular">{dateLabel(s.rec.date)}</span>
                  <span className="text-ink-3">set {s.rec.setNumber}</span>
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-label={`Remove ${dateLabel(s.rec.date)} from comparison`}
                    className="flex size-6 cursor-pointer items-center justify-center rounded-full text-ink-3 hover:bg-canvas hover:text-ink"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="px-2 pb-4 sm:px-3">
            {!ordered.length && (
              <div className="mx-3 flex h-[320px] flex-col items-center justify-center gap-2 rounded-xl bg-canvas text-center">
                <Layers className="size-6 text-ink-3" aria-hidden />
                <p className="text-sm font-medium">{plain ? "Pick two or more days to see them layered" : "Select recordings to overlay"}</p>
                <p className="text-[13px] text-ink-2">Try a quick pick on the left — like “{presets[0].label}”.</p>
              </div>
            )}
            {error && <p className="px-3 py-6 text-center text-sm text-bad">Could not load a recording: {error}</p>}
            {ordered.length > 0 && rawLocked && (
              <div className="mx-3 flex h-[320px] items-center justify-center rounded-xl bg-canvas text-sm text-ink-2">
                Raw and rectified signals were not included in this share. Envelope is available.
              </div>
            )}
            {ordered.length > 0 && !rawLocked && !chart && <div className="mx-3 h-[320px] animate-pulse rounded-xl bg-canvas" />}
            {chart && (
              <UChart
                key={slotsKey + channel + mode + unit}
                options={options}
                data={chart.data}
                height={340}
                tooltip={tooltip}
                onCreate={setPlot}
                ariaLabel={`Overlay of ${ordered.length} recordings of ${exName}`}
              />
            )}
          </div>
        </Card>

        {ordered.length > 0 && <ComparisonTable ordered={ordered} plain={plain} simple={simple} />}
      </div>
    </div>
  );
}

function ComparisonTable({
  ordered,
  plain,
  simple,
}: {
  ordered: { id: string; slot: number; rec: CompareRecording }[];
  plain: boolean;
  simple: boolean;
}) {
  const first = ordered[0].rec;
  const last = ordered[ordered.length - 1].rec;
  const ratio = last.peak / first.peak;
  const change = (v: number, base: number) => ((v - base) / base) * 100;
  const days = Math.round((new Date(last.date).getTime() - new Date(first.date).getTime()) / 864e5);

  return (
    <Card>
      {ordered.length > 1 && (
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <p className="text-[15px] leading-relaxed">
            {plain ? (
              <>
                Over <b>{days} days</b>, your strongest effort went from <b className="tabular">{first.peak.toFixed(2)} mV</b> to{" "}
                <b className="tabular">{last.peak.toFixed(2)} mV</b> —{" "}
                {ratio >= 1.05 ? (
                  <span className="font-semibold text-good">{ratio >= 1.5 ? `${ratio.toFixed(1)}× as strong` : `${change(last.peak, first.peak).toFixed(0)}% stronger`}</span>
                ) : ratio <= 0.95 ? (
                  <span className="font-semibold text-warn">{Math.abs(change(last.peak, first.peak)).toFixed(0)}% lower</span>
                ) : (
                  <span className="font-semibold">about the same</span>
                )}
                .
              </>
            ) : (
              <>
                Peak envelope {change(last.peak, first.peak) >= 0 ? "increased" : "decreased"}{" "}
                <b className="tabular">{Math.abs(change(last.peak, first.peak)).toFixed(1)}%</b> over {days} days (
                {first.peak.toFixed(3)} → {last.peak.toFixed(3)} mV). Median frequency {last.mdf >= first.mdf ? "+" : ""}
                {(last.mdf - first.mdf).toFixed(1)} Hz; fatigue index {first.fatigue.toFixed(0)}% → {last.fatigue.toFixed(0)}%.
              </>
            )}
          </p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={cx("w-full text-sm", simple ? "min-w-[360px]" : "min-w-[620px]")}>
          <thead>
            <tr className="text-left text-[12px] text-ink-2">
              <th className="px-5 py-3 font-medium sm:px-6">Recording</th>
              <th className="px-3 py-3 text-right font-medium">{plain ? "Strongest effort" : "Peak"}</th>
              <th className={cx("py-3 text-right font-medium", simple ? "px-5 sm:px-6" : "px-3")}>vs first</th>
              {!simple && (
                <>
                  <th className="px-3 py-3 text-right font-medium">{plain ? "Average effort" : "Mean"}</th>
                  <th className="px-3 py-3 text-right font-medium" title="Median frequency">{plain ? "Freshness" : "MDF"}</th>
                  <th className="px-5 py-3 text-right font-medium sm:px-6" title="Last reps vs first reps">{plain ? "Effort drop" : "Fatigue idx"}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {ordered.map((s, i) => {
              const c = change(s.rec.peak, first.peak);
              return (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-5 py-3 sm:px-6">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block size-2.5 rounded-full" style={{ background: SERIES_COLORS[s.slot] }} />
                      <span className="font-medium tabular">{dateLabel(s.rec.date, true)}</span>
                      <span className="text-ink-3">set {s.rec.setNumber}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular">{s.rec.peak.toFixed(3)} mV</td>
                  <td className={cx("py-3 text-right font-medium tabular", simple ? "px-5 sm:px-6" : "px-3", i === 0 ? "text-ink-3" : c > 0.5 ? "text-good" : c < -0.5 ? "text-bad" : "text-ink-2")}>
                    {i === 0 ? "reference" : `${c > 0 ? "+" : ""}${c.toFixed(1)}%`}
                  </td>
                  {!simple && (
                    <>
                      <td className="px-3 py-3 text-right tabular">{s.rec.mean.toFixed(3)} mV</td>
                      <td className="px-3 py-3 text-right tabular">{s.rec.mdf.toFixed(0)} Hz</td>
                      <td className="px-5 py-3 text-right tabular sm:px-6">{s.rec.fatigue.toFixed(0)}%</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
