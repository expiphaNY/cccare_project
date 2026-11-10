"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { btn, cx } from "../ui";

export type Range = [number, number];

/** Keeps a view window inside the domain and at least `minSpan` wide. */
export function clampRange([a, b]: Range, [d0, d1]: Range, minSpan: number): Range {
  const full = d1 - d0;
  let span = Math.min(full, Math.max(minSpan, b - a));
  if (span >= full) return [d0, d1];
  let s = Math.max(d0, Math.min(a, d1 - span));
  if (!Number.isFinite(s)) s = d0;
  span = Math.min(span, d1 - s);
  return [s, s + span];
}

/** Zoom by `factor` (>1 zooms in) around `anchor` (defaults to the centre). */
export function zoomRange(view: Range, domain: Range, factor: number, minSpan: number, anchor?: number): Range {
  const [a, b] = view;
  const at = anchor ?? (a + b) / 2;
  const span = (b - a) / factor;
  const k = (at - a) / (b - a || 1);
  return clampRange([at - span * k, at - span * k + span], domain, minSpan);
}

/** Shifts the window by `frac` of its own width (negative = left). */
export function panRange(view: Range, domain: Range, frac: number, minSpan: number): Range {
  const d = (view[1] - view[0]) * frac;
  return clampRange([view[0] + d, view[1] + d], domain, minSpan);
}

// The viewer the pointer/focus was last in owns the keyboard, so two charts
// on one page don't both zoom.
let activeOwner: symbol | null = null;

function typingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

/**
 * Keyboard zoom for a chart: + / − zoom, ← / → pan, 0 resets.
 * Returns props to spread on the chart's wrapper (marks it as the active chart
 * on hover/focus) and a wheel handler for ctrl/pinch zoom and sideways panning.
 */
export function useChartZoom({
  domain,
  view,
  setView,
  minSpan,
  enabled = true,
}: {
  domain: Range;
  view: Range | null;
  setView: (r: Range | null) => void;
  minSpan: number;
  enabled?: boolean;
}) {
  const [owner] = useState(() => Symbol("chart"));
  const state = useRef({ domain, view, setView, minSpan });
  useEffect(() => {
    state.current = { domain, view, setView, minSpan };
  });
  useEffect(() => {
    if (!enabled) return;
    if (!activeOwner) activeOwner = owner;
    const onKey = (e: KeyboardEvent) => {
      if (activeOwner !== owner || e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return;
      const { domain: d, view: v, setView: set, minSpan: m } = state.current;
      const cur = v ?? d;
      const commit = (r: Range) => set(r[0] <= d[0] && r[1] >= d[1] ? null : r);
      if (e.key === "+" || e.key === "=") commit(zoomRange(cur, d, 1.5, m));
      else if (e.key === "-" || e.key === "_") commit(zoomRange(cur, d, 1 / 1.5, m));
      else if (e.key === "0") set(null);
      else if (e.key === "ArrowLeft" && v) commit(panRange(cur, d, e.shiftKey ? -0.8 : -0.25, m));
      else if (e.key === "ArrowRight" && v) commit(panRange(cur, d, e.shiftKey ? 0.8 : 0.25, m));
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (activeOwner === owner) activeOwner = null;
    };
  }, [enabled, owner]);

  const claim = useCallback(() => {
    activeOwner = owner;
  }, [owner]);

  // Native listener: React's onWheel is passive, so it can't stop page zoom.
  const wheelEl = useRef<HTMLElement | null>(null);
  const wheelTarget = useCallback(
    (el: HTMLElement | null) => {
      const prev = wheelEl.current;
      if (prev) prev.removeEventListener("wheel", (prev as HTMLElement & { _zw?: EventListener })._zw!);
      wheelEl.current = el;
      if (!el || !enabled) return;
      const h = (ev: Event) => {
        const e = ev as WheelEvent;
        const { domain: d, view: v, setView: set, minSpan: m } = state.current;
        const cur = v ?? d;
        const plot = el.querySelector(".u-over") as HTMLElement | null;
        const box = (plot ?? el).getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / (box.width || 1)));
        const commit = (r: Range) => set(r[0] <= d[0] && r[1] >= d[1] ? null : r);
        if (e.ctrlKey) {
          // Trackpad pinch (and ctrl + scroll wheel): zoom around the pointer.
          e.preventDefault();
          commit(zoomRange(cur, d, Math.exp(-e.deltaY * 0.01), m, cur[0] + frac * (cur[1] - cur[0])));
        } else if (v && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          e.preventDefault();
          commit(panRange(cur, d, e.deltaX / (box.width || 1), m));
        }
      };
      (el as HTMLElement & { _zw?: EventListener })._zw = h;
      el.addEventListener("wheel", h, { passive: false });
    },
    [enabled],
  );

  return { wrapperProps: { onPointerEnter: claim, onFocusCapture: claim }, wheelTarget };
}

/**
 * Zoom slider (how much of the recording is visible) plus a position slider
 * (which part) once zoomed in. Zoom is logarithmic so each step feels equal.
 */
export function ZoomBar({
  domain,
  view,
  setView,
  minSpan,
  format,
  className,
}: {
  domain: Range;
  view: Range | null;
  setView: (r: Range | null) => void;
  minSpan: number;
  format: (span: number) => string;
  className?: string;
}) {
  const id = useId();
  const full = domain[1] - domain[0];
  const cur = view ?? domain;
  const span = cur[1] - cur[0];
  const maxZoom = Math.max(1, full / minSpan);
  const canZoom = maxZoom > 1.05;
  const STEPS = 1000;
  const level = canZoom ? Math.round((Math.log(full / span) / Math.log(maxZoom)) * STEPS) : 0;
  const posMax = full - span;
  const pos = posMax > 0 ? ((cur[0] - domain[0]) / posMax) * STEPS : 0;

  const setLevel = (l: number) => {
    if (l <= 0) return setView(null);
    const s = full / Math.pow(maxZoom, l / STEPS);
    const centre = (cur[0] + cur[1]) / 2;
    setView(clampRange([centre - s / 2, centre + s / 2], domain, minSpan));
  };
  const setPos = (p: number) => {
    const s0 = domain[0] + (p / STEPS) * posMax;
    setView(clampRange([s0, s0 + span], domain, minSpan));
  };
  const step = (factor: number) => {
    const r = zoomRange(cur, domain, factor, minSpan);
    setView(r[0] <= domain[0] && r[1] >= domain[1] ? null : r);
  };

  if (!canZoom) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-2", className)}>
      <div className="flex min-w-[220px] flex-1 items-center gap-1.5">
        <button type="button" className={cx(btn.ghost, "size-7 min-h-0 p-0")} onClick={() => step(1 / 1.5)} disabled={!view} aria-label="Zoom out" title="Zoom out ( − )">
          <Minus className="size-3.5" aria-hidden />
        </button>
        <label htmlFor={`${id}-z`} className="sr-only">
          Zoom
        </label>
        <input
          id={`${id}-z`}
          type="range"
          min={0}
          max={STEPS}
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="zoom-range flex-1"
          aria-valuetext={`Showing ${format(span)} of ${format(full)}`}
        />
        <button type="button" className={cx(btn.ghost, "size-7 min-h-0 p-0")} onClick={() => step(1.5)} disabled={span <= minSpan * 1.01} aria-label="Zoom in" title="Zoom in ( + )">
          <Plus className="size-3.5" aria-hidden />
        </button>
        <span className="shrink-0 whitespace-nowrap pl-1 text-right tabular">
          {format(span)} <span className="text-ink-3">/ {format(full)}</span>
        </span>
      </div>
      {view && (
        <div className="flex min-w-[200px] flex-1 items-center gap-2">
          <label htmlFor={`${id}-p`} className="shrink-0">
            Position
          </label>
          <input
            id={`${id}-p`}
            type="range"
            min={0}
            max={STEPS}
            value={Math.round(pos)}
            onChange={(e) => setPos(Number(e.target.value))}
            className="zoom-range flex-1"
            aria-valuetext={`${format(cur[0] - domain[0])} to ${format(cur[1] - domain[0])}`}
          />
          <button type="button" className={cx(btn.ghost, btn.small)} onClick={() => setView(null)} title="Show everything ( 0 )">
            <RotateCcw className="size-3.5" aria-hidden /> All
          </button>
        </div>
      )}
      <span className="hidden text-ink-3 lg:inline">
        Keys: <kbd>+</kbd> <kbd>−</kbd> zoom · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>0</kbd> reset · pinch to zoom
      </span>
    </div>
  );
}

/** "12.5 s", "1:05", for seconds. */
export function fmtSpan(s: number) {
  if (s < 10) return `${s.toFixed(s < 1 ? 2 : 1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}
