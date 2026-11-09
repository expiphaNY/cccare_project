"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
export const AXIS = {
  stroke: "#5c6b82",
  grid: { stroke: "#eef2f7", width: 1 },
  ticks: { stroke: "#e1e8f1", width: 1, size: 4 },
  font: '12px -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
};

export type TooltipFormatter = (u: uPlot, idx: number) => string | null;

/** Crosshair tooltip that follows the cursor, flips at the right edge. */
function tooltipPlugin(format: TooltipFormatter): uPlot.Plugin {
  let tip: HTMLDivElement;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement("div");
        tip.className = "chart-tip";
        tip.style.display = "none";
        u.over.appendChild(tip);
        u.over.addEventListener("mouseleave", () => (tip.style.display = "none"));
      },
      setCursor: (u) => {
        const { left, top, idx } = u.cursor;
        if (idx == null || left == null || top == null || left < 0) {
          tip.style.display = "none";
          return;
        }
        const html = format(u, idx);
        if (!html) {
          tip.style.display = "none";
          return;
        }
        tip.innerHTML = html;
        tip.style.display = "block";
        const w = tip.offsetWidth;
        const overW = u.over.clientWidth;
        const x = left + 14 + w > overW ? left - w - 14 : left + 14;
        tip.style.left = `${Math.max(0, x)}px`;
        tip.style.top = `${Math.max(0, Math.min(top - 10, u.over.clientHeight - tip.offsetHeight))}px`;
      },
    },
  };
}

export function UChart({
  options,
  data,
  height = 260,
  tooltip,
  className,
  ariaLabel,
  onCreate,
}: {
  options: Omit<uPlot.Options, "width" | "height">;
  data: uPlot.AlignedData;
  height?: number;
  tooltip?: TooltipFormatter;
  className?: string;
  ariaLabel: string;
  onCreate?: (u: uPlot) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const dataRef = useRef(data);
  // Keep the latest data for chart rebuilds (runs before the create effect).
  useEffect(() => {
    dataRef.current = data;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opts: uPlot.Options = {
      ...options,
      width: el.clientWidth || 600,
      height,
      plugins: [...(options.plugins ?? []), ...(tooltip ? [tooltipPlugin(tooltip)] : [])],
    };
    const u = new uPlot(opts, dataRef.current, el);
    plot.current = u;
    onCreate?.(u);
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) u.setSize({ width: el.clientWidth, height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
    // Options identity is the rebuild signal; callers memoise it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, height, tooltip]);

  useEffect(() => {
    plot.current?.setData(data);
  }, [data]);

  return <div ref={ref} className={className} role="img" aria-label={ariaLabel} style={{ minHeight: height }} />;
}

export function fmtNum(v: number | null | undefined, d = 2) {
  return v == null || Number.isNaN(v) ? "–" : v.toFixed(d);
}

export function swatch(color: string, dashed = false) {
  return `<span style="display:inline-block;width:10px;height:${dashed ? 0 : 10}px;${
    dashed ? `border-top:2px dashed ${color};` : `background:${color};`
  }border-radius:3px;margin-right:6px;vertical-align:middle"></span>`;
}
