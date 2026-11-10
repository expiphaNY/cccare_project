"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type uPlot from "uplot";
import { METRICS, type MetricKey } from "@/lib/analytics";
import { fmtDate, fmtTime } from "@/lib/format";
import { Segmented } from "../Segmented";
import { AXIS, SERIES_COLORS, UChart, fmtNum, swatch } from "./UChart";
import { ZoomBar, useChartZoom } from "./zoom";

const DAY = 86400;
function fmtDays(s: number) {
  const d = s / DAY;
  if (d < 1.5) return `${Math.max(1, Math.round(s / 3600))} h`;
  if (d < 14) return `${Math.round(d)} d`;
  if (d < 90) return `${Math.round(d / 7)} wk`;
  return `${(d / 30.4).toFixed(d < 300 ? 0 : 1)} mo`;
}

export interface TrendPoint {
  t: number; // unix seconds
  v: number;
  sessionId: string;
}

export interface TrendPanelProps {
  exercises: { key: string; name: string; muscle: string }[];
  trends: Record<string, Partial<Record<MetricKey, TrendPoint[]>>>;
  metrics: MetricKey[];
  /** Where clicking a point goes; session id is appended. Omit to disable drill-down. */
  sessionHref?: string;
  audience: "clinician" | "patient";
  height?: number;
}

export function TrendPanel({ exercises, trends, metrics, sessionHref, audience, height = 280 }: TrendPanelProps) {
  const router = useRouter();
  const [metric, setMetric] = useState<MetricKey>(metrics[0]);
  const [ex, setEx] = useState<string>(exercises.length > 1 && audience === "clinician" ? "all" : exercises[0].key);
  const def = METRICS[metric];
  const shown = useMemo(() => (ex === "all" ? exercises : exercises.filter((e) => e.key === ex)), [ex, exercises]);

  const { data, sessionsAt, baseline } = useMemo(() => {
    const xs = new Set<number>();
    for (const e of shown) for (const p of trends[e.key]?.[metric] ?? []) xs.add(p.t);
    const x = [...xs].sort((a, b) => a - b);
    const sessionsAt = new Map<number, string>();
    const ys = shown.map((e) => {
      const map = new Map((trends[e.key]?.[metric] ?? []).map((p) => [p.t, p]));
      return x.map((t) => {
        const p = map.get(t);
        if (p) sessionsAt.set(t, p.sessionId);
        return p ? p.v : null;
      });
    });
    const first = shown.length === 1 ? (trends[shown[0].key]?.[metric]?.[0]?.v ?? null) : null;
    const baseline = first;
    return { data: [x, ...ys, ...(first != null ? [x.map(() => first)] : [])] as uPlot.AlignedData, sessionsAt, baseline };
  }, [shown, trends, metric]);

  // Zoom across the session timeline (pads the ends so edge points aren't clipped).
  const xs = data[0] as number[];
  const pad = xs.length > 1 ? Math.max(DAY / 2, (xs[xs.length - 1] - xs[0]) * 0.02) : DAY;
  const domain = useMemo<[number, number]>(() => (xs.length ? [xs[0] - pad, xs[xs.length - 1] + pad] : [0, DAY]), [xs, pad]);
  const [view, setView] = useState<[number, number] | null>(null);
  const { wrapperProps: zoomProps, wheelTarget: zoomTarget } = useChartZoom({ domain, view, setView, minSpan: 3 * DAY });
  const plot = useRef<uPlot | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
    const u = plot.current;
    if (u?.root.isConnected) u.setScale("x", { min: (view ?? domain)[0], max: (view ?? domain)[1] });
  }, [view, domain]);

  const options = useMemo<Omit<uPlot.Options, "width" | "height">>(
    () => ({
      padding: [12, 12, 0, 0],
      cursor: {
        points: { size: 9, width: 2, fill: "#fff" },
        drag: { x: false, y: false },
        y: false,
      },
      scales: { x: { time: true, range: () => viewRef.current ?? domain } },
      axes: [
        { ...AXIS, values: (_u, vals) => vals.map((v) => new Date(v * 1000).toLocaleDateString("en-CA", { month: "short", day: "numeric" })) },
        { ...AXIS, size: 52, values: (_u, vals) => vals.map((v) => `${v.toFixed(def.digits === 0 ? 0 : def.digits > 2 ? 2 : def.digits)}`), label: def.unit, labelSize: 16, labelFont: AXIS.font },
      ],
      series: [
        {},
        ...shown.map((e, i) => ({
          label: e.name,
          stroke: SERIES_COLORS[i],
          width: 2,
          spanGaps: true,
          points: { show: true, size: 6, width: 1.5, stroke: SERIES_COLORS[i], fill: "#fff" },
        })),
        ...(baseline != null
          ? [{ label: "Baseline", stroke: "#8a97ab", width: 1.25, dash: [5, 5], points: { show: false } }]
          : []),
      ],
      legend: { show: false },
      hooks: sessionHref
        ? {
            ready: [
              (u: uPlot) => {
                u.over.style.cursor = "pointer";
                u.over.addEventListener("click", () => {
                  const idx = u.cursor.idx;
                  if (idx == null) return;
                  const sid = sessionsAt.get(u.data[0][idx] as number);
                  if (sid) router.push(`${sessionHref}/${sid}`);
                });
              },
            ],
          }
        : {},
    }),
    [shown, def, baseline, sessionHref, sessionsAt, router, domain],
  );

  const tooltip = useMemo(
    () => (u: uPlot, idx: number) => {
      const t = u.data[0][idx] as number;
      const rows = shown
        .map((e, i) => {
          const v = u.data[i + 1][idx];
          return v == null ? "" : `<div>${swatch(SERIES_COLORS[i])}${e.name}: <b>${fmtNum(v as number, def.digits)} ${def.unit}</b></div>`;
        })
        .join("");
      const base =
        baseline != null
          ? `<div style="color:#5c6b82">${swatch("#8a97ab", true)}${audience === "patient" ? "Where you started" : "Baseline"}: ${fmtNum(baseline, def.digits)} ${def.unit}</div>`
          : "";
      return `<div style="font-weight:600;margin-bottom:4px">${fmtDate(new Date(t * 1000).toISOString(), { weekday: "short", year: undefined })} · ${fmtTime(new Date(t * 1000).toISOString())}</div>${rows}${base}${
        sessionHref ? `<div style="color:#0b63ce;margin-top:4px">Click to open session →</div>` : ""
      }`;
    },
    [shown, def, baseline, audience, sessionHref],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3 sm:px-6">
        {metrics.length > 1 && (
          <Segmented
            label="Metric"
            value={metric}
            onChange={setMetric}
            size="sm"
            options={metrics.map((m) => ({
              value: m,
              label: audience === "patient" ? METRICS[m].plain : METRICS[m].label,
              title: METRICS[m].help,
            }))}
          />
        )}
        {exercises.length > 1 && (
          <Segmented
            label="Exercise"
            value={ex}
            onChange={setEx}
            size="sm"
            options={[
              ...(audience === "clinician" ? [{ value: "all", label: "All exercises" }] : []),
              ...exercises.map((e) => ({ value: e.key, label: e.name })),
            ]}
          />
        )}
      </div>
      <div className="px-2 sm:px-3" {...zoomProps} ref={zoomTarget}>
        <UChart
          options={options}
          data={data}
          height={height}
          tooltip={tooltip}
          ariaLabel={`${def.label} over time for ${shown.map((s) => s.name).join(" and ")}`}
          onCreate={(u) => (plot.current = u)}
        />
      </div>
      <ZoomBar domain={domain} view={view} setView={setView} minSpan={3 * DAY} format={fmtDays} className="px-5 pt-2 sm:px-6" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-4 pt-2 text-[13px] text-ink-2 sm:px-6">
        {shown.map((e, i) => (
          <span key={e.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: SERIES_COLORS[i] }} />
            {e.name} <span className="text-ink-3">· {e.muscle}</span>
          </span>
        ))}
        {baseline != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-[#8a97ab]" />
            {audience === "patient" ? "Where you started" : "Baseline (first session)"}
          </span>
        )}
        {sessionHref && <span className="ml-auto text-ink-3">Tip: click any point to open that session</span>}
      </div>
    </div>
  );
}
