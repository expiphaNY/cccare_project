// =============================================================================
// SignalViewer.tsx : THE SET'S SIGNAL CHARTS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Draws the channels of one set (envelope, and for demo data raw and rectified) on synced, zoomable charts, with a jump-to-rep list, and shows the arm-movement panel beneath.
// =============================================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import { Info, Lock, ZoomIn } from "lucide-react";
import { CHANNELS, type ChannelKey, type TremorMetrics } from "@/lib/types";
import { detectReps, useSignal, type ClientSignal } from "@/lib/client-signal";
import { Segmented } from "../Segmented";
import { cx } from "../ui";
import { AXIS, UChart, fmtNum } from "./UChart";
import { ZoomBar, fmtSpan, useChartZoom } from "./zoom";
import { MotionPanel } from "./RepCheckPanel";
import type { ClientAction } from "@/lib/agent/protocol";
import { HIGHLIGHT_EVENT } from "@/lib/agent/target";

type View = ChannelKey | "all";

const CH_COLOR: Record<ChannelKey, string> = { envelope: "#0b63ce", rectified: "#2a78d6", raw: "#43536b" };

export function SignalViewer({
  recordingId,
  access,
  audience,
  title,
  tremor,
}: {
  recordingId: string;
  access: string;
  audience: "clinician" | "recipient";
  title?: string;
  /** Shakiness stored when the set was saved (uses the sensor's real packet rate). */
  tremor?: TremorMetrics;
}) {
  const { data, error } = useSignal(recordingId, access);
  const [view, setView] = useState<View>(audience === "clinician" ? "all" : "envelope");
  const [range, setRange] = useState<[number, number] | null>(null);
  // Span the assistant is pointing at (drawn as a stronger band), cleared after a few seconds.
  const focus = useRef<[number, number] | null>(null);

  const hasRaw = !!data?.raw;
  // Envelope-only sensors (e.g. MyoWare over Bluetooth) never measured raw/rectified.
  const measured = data?.channels ?? (["envelope", "rectified", "raw"] as ChannelKey[]);
  const envelopeOnly = !measured.includes("raw") && !measured.includes("rectified");
  const reps = useMemo(() => (data ? detectReps(data.envelope, data.fs) : []), [data]);
  const views: { value: View; label: string }[] = (
    [
      { value: "envelope", label: "Envelope" },
      { value: "rectified", label: "Rectified" },
      { value: "raw", label: "Raw EMG" },
      { value: "all", label: "All three" },
    ] as { value: View; label: string }[]
  ).filter((v) => (v.value === "all" ? !envelopeOnly : measured.includes(v.value)));

  const plain = audience !== "clinician";
  const effectiveView: View = envelopeOnly ? "envelope" : view;
  const channelsShown: ChannelKey[] = effectiveView === "all" ? ["envelope", "rectified", "raw"] : [effectiveView];
  const locked = !hasRaw && channelsShown.some((c) => c !== "envelope");
  const duration = data ? data.n / data.fs : 0;
  const domain = useMemo<[number, number]>(() => [0, duration], [duration]);
  // Closest zoom: ~50 samples on screen, never under 0.1 s.
  const minSpan = data ? Math.max(0.1, 50 / data.fs) : 1;
  useEffect(() => {
    let clear = 0;
    const onHighlight = (e: Event) => {
      const a = (e as CustomEvent<ClientAction>).detail;
      if (a.target !== "signal-chart" || !data) return;
      let span: [number, number] | null = null;
      if (a.rep && reps[a.rep - 1]) span = [reps[a.rep - 1].start, reps[a.rep - 1].end];
      else if (a.start != null && a.end != null && a.end > a.start) span = [Math.max(0, a.start), Math.min(data.n / data.fs, a.end)];
      if (!span) return;
      focus.current = span;
      const pad = Math.max(0.4, (span[1] - span[0]) * 0.25);
      setRange([Math.max(0, span[0] - pad), Math.min(data.n / data.fs, span[1] + pad)]);
      window.clearTimeout(clear);
      clear = window.setTimeout(() => {
        focus.current = null;
        setRange((r) => (r ? [r[0], r[1]] : r)); // new identity → charts redraw without the band
      }, 7000);
    };
    window.addEventListener(HIGHLIGHT_EVENT, onHighlight);
    return () => {
      window.removeEventListener(HIGHLIGHT_EVENT, onHighlight);
      window.clearTimeout(clear);
    };
  }, [data, reps]);

  const { wrapperProps: zoomProps, wheelTarget: zoomTarget } = useChartZoom({ domain, view: range, setView: setRange, minSpan, enabled: !!data });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3 sm:px-6">
        {title && <h3 className="mr-2 text-[15px] font-semibold">{title}</h3>}
        {views.length > 1 ? (
          <Segmented label="Signal channel" value={effectiveView} onChange={setView} options={views} size="sm" />
        ) : (
          envelopeOnly && (
            <span className="text-[12px] text-ink-3">
              {plain ? "This sensor sends the effort line only." : "Envelope only: this sensor did not stream raw or rectified EMG."}
            </span>
          )
        )}
        {!range && (
          <span className="ml-auto hidden items-center gap-1 text-[12px] text-ink-3 md:inline-flex">
            <ZoomIn className="size-3.5" aria-hidden /> Drag across the chart to zoom
          </span>
        )}
      </div>

      {reps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3 sm:px-6" aria-label="Jump to repetition">
          <span className="mr-1 text-[12px] text-ink-3">Jump to rep</span>
          {reps.map((r, i) => {
            const active = range && Math.abs(range[0] - (r.start - 0.4)) < 0.01;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setRange([Math.max(0, r.start - 0.4), r.end + 0.4])}
                className={cx(
                  "pressable min-h-7 min-w-7 cursor-pointer rounded-full px-2 text-[12px] font-medium tabular",
                  active ? "bg-brand text-white" : "bg-canvas text-ink-2 hover:bg-brand-soft hover:text-brand",
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-2 sm:px-3" {...zoomProps} ref={zoomTarget}>
        {error && <p className="px-3 py-10 text-center text-sm text-bad">Could not load signal: {error}</p>}
        {!data && !error && <div className="mx-3 h-[260px] animate-pulse rounded-xl bg-canvas" />}
        {data && locked && (
          <div className="mx-3 flex h-[200px] flex-col items-center justify-center gap-2 rounded-xl bg-canvas text-center text-sm text-ink-2">
            <Lock className="size-5 text-ink-3" aria-hidden />
            Raw and rectified signals were not included in this share.
          </div>
        )}
        {data && !locked && (
          <StackedCharts data={data} channels={channelsShown} range={range} setRange={setRange} reps={reps} focus={focus} />
        )}
        {data?.motion && <MotionPanel data={data} plain={plain} range={range} stored={tremor} />}
      </div>
      {data && (
        <ZoomBar domain={domain} view={range} setView={setRange} minSpan={minSpan} format={fmtSpan} className="px-5 pt-3 sm:px-6" />
      )}

      <div className="grid gap-3 px-5 pb-5 pt-2 sm:px-6 md:grid-cols-3">
        {channelsShown.map((c) => (
          <div key={c} className="flex gap-2 text-[13px] text-ink-2">
            <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
            <p>
              <span className="font-medium text-ink">{CHANNELS[c].label}.</span>{" "}
              {plain ? CHANNELS[c].plain : CHANNELS[c].clinical}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StackedCharts({
  data,
  channels,
  range,
  setRange,
  reps,
  focus,
}: {
  data: ClientSignal;
  channels: ChannelKey[];
  range: [number, number] | null;
  setRange: (r: [number, number] | null) => void;
  reps: { start: number; end: number }[];
  focus: React.RefObject<[number, number] | null>;
}) {
  const plots = useRef(new Map<ChannelKey, uPlot>());
  const x = useMemo(() => {
    const a = new Float64Array(data.n);
    for (let i = 0; i < data.n; i++) a[i] = i / data.fs;
    return a;
  }, [data]);

  const height = channels.length === 1 ? 300 : 170;
  const syncKey = `sig-${data.id}`;

  // Apply zoom range to all charts.
  const applyRange = useCallback(
    (u: uPlot) => {
      if (range) u.setScale("x", { min: range[0], max: range[1] });
    },
    [range],
  );
  useEffect(() => {
    for (const [ch, u] of plots.current) {
      if (!channels.includes(ch) || !u.root.isConnected) {
        plots.current.delete(ch);
        continue;
      }
      u.setScale("x", range ? { min: range[0], max: range[1] } : { min: 0, max: data.n / data.fs });
    }
  }, [range, data, channels]);

  return (
    <div className="flex flex-col gap-1">
      {channels.map((ch, idx) => (
        <ChannelChart
          key={ch}
          ch={ch}
          x={x}
          y={data[ch]!}
          height={height}
          syncKey={syncKey}
          showXAxis={idx === channels.length - 1}
          reps={reps}
          focus={focus}
          onSelect={setRange}
          onCreate={(u) => {
            plots.current.set(ch, u);
            applyRange(u);
          }}
          label={channels.length > 1 ? CHANNELS[ch].label : undefined}
        />
      ))}
    </div>
  );
}

function ChannelChart({
  ch,
  x,
  y,
  height,
  syncKey,
  showXAxis,
  reps,
  focus,
  onSelect,
  onCreate,
  label,
}: {
  ch: ChannelKey;
  x: Float64Array;
  y: Float32Array;
  height: number;
  syncKey: string;
  showXAxis: boolean;
  reps: { start: number; end: number }[];
  focus: React.RefObject<[number, number] | null>;
  onSelect: (r: [number, number]) => void;
  onCreate: (u: uPlot) => void;
  label?: string;
}) {
  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      padding: [8, 12, 0, 0],
      cursor: {
        sync: { key: syncKey, setSeries: false },
        drag: { x: true, y: false, setScale: false },
        points: { show: false },
        y: false,
      },
      select: { show: true, left: 0, top: 0, width: 0, height: 0 },
      scales: { x: { time: false } },
      axes: [
        { ...AXIS, show: showXAxis, values: (_u, v) => v.map((s) => `${s.toFixed(s < 10 ? 1 : 0)} s`) },
        { ...AXIS, size: 56, values: (_u, v) => v.map((n) => n.toFixed(Math.abs(n) >= 100 ? 0 : 2)), label: label ? `${label} (mV)` : "mV", labelSize: 16, labelFont: AXIS.font },
      ],
      series: [
        {},
        {
          label: CHANNELS[ch].label,
          stroke: CH_COLOR[ch],
          width: ch === "envelope" ? 2 : 1,
          fill: ch === "envelope" ? "rgba(11,99,206,0.08)" : undefined,
          points: { show: false },
        },
      ],
      legend: { show: false },
      hooks: {
        drawAxes: [
          (u: uPlot) => {
            const { ctx, bbox } = u;
            ctx.save();
            ctx.fillStyle = "rgba(11,99,206,0.045)";
            for (const r of reps) {
              const x0 = u.valToPos(r.start, "x", true);
              const x1 = u.valToPos(r.end, "x", true);
              if (x1 < bbox.left || x0 > bbox.left + bbox.width) continue;
              ctx.fillRect(Math.max(bbox.left, x0), bbox.top, Math.min(bbox.left + bbox.width, x1) - Math.max(bbox.left, x0), bbox.height);
            }
            const f = focus.current;
            if (f) {
              const x0 = Math.max(bbox.left, u.valToPos(f[0], "x", true));
              const x1 = Math.min(bbox.left + bbox.width, u.valToPos(f[1], "x", true));
              if (x1 > x0) {
                ctx.fillStyle = "rgba(11,99,206,0.16)";
                ctx.fillRect(x0, bbox.top, x1 - x0, bbox.height);
                ctx.fillStyle = "rgba(11,99,206,0.9)";
                ctx.fillRect(x0, bbox.top, 2, bbox.height);
                ctx.fillRect(x1 - 2, bbox.top, 2, bbox.height);
              }
            }
            ctx.restore();
          },
        ],
        setSelect: [
          (u: uPlot) => {
            if (u.select.width < 6) return;
            const a = u.posToVal(u.select.left, "x");
            const b = u.posToVal(u.select.left + u.select.width, "x");
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            onSelect([a, b]);
          },
        ],
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ch, syncKey, showXAxis, reps, label],
  );

  const tooltip = useMemo(
    () => (u: uPlot, idx: number) =>
      `<div style="color:#5c6b82">${(u.data[0][idx] as number).toFixed(3)} s</div><div><b>${fmtNum(u.data[1][idx] as number, 3)} mV</b> ${CHANNELS[ch].label}</div>`,
    [ch],
  );

  const data = useMemo(() => [x, y] as unknown as uPlot.AlignedData, [x, y]);

  return (
    <UChart
      options={options}
      data={data}
      height={height}
      tooltip={tooltip}
      onCreate={onCreate}
      ariaLabel={`${CHANNELS[ch].label} signal over time`}
    />
  );
}
