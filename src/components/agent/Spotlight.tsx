// =============================================================================
// Spotlight.tsx : THE ASSISTANT'S POINTER
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   A temporary dimming mask that highlights one part of the page when the assistant says 'look here', then goes away.
// =============================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ClientAction } from "@/lib/agent/protocol";
import { HIGHLIGHT_EVENT } from "@/lib/agent/target";

const SHOW_MS = 7000;
const PAD = 8;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Temporary mask the assistant uses to point at part of the page: dims
 * everything except the target, rings it, and shows a caption. Never blocks
 * input (pointer-events: none) and goes away on its own, on Esc, or on ✕.
 */
export function Spotlight() {
  const [action, setAction] = useState<ClientAction | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number>(0);

  useEffect(() => {
    const onHighlight = (e: Event) => {
      const a = (e as CustomEvent<ClientAction>).detail;
      const el = document.querySelector<HTMLElement>(`[data-agent-target="${CSS.escape(a.target)}"]`);
      if (!el) return;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      setLeaving(false);
      setAction(a);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setLeaving(true), SHOW_MS);
    };
    window.addEventListener(HIGHLIGHT_EVENT, onHighlight);
    return () => window.removeEventListener(HIGHLIGHT_EVENT, onHighlight);
  }, []);

  // Track the target while scrolling/resizing.
  useEffect(() => {
    if (!action) return;
    let raf = 0;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-agent-target="${CSS.escape(action.target)}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) => (prev && prev.x === r.left && prev.y === r.top && prev.w === r.width && prev.h === r.height ? prev : { x: r.left, y: r.top, w: r.width, h: r.height }));
      } else setLeaving(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLeaving(true);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [action]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => {
      setAction(null);
      setRect(null);
      setLeaving(false);
    }, 220);
    return () => window.clearTimeout(t);
  }, [leaving]);

  if (!action || !rect) return null;
  const x = rect.x - PAD;
  const y = rect.y - PAD;
  const w = rect.w + PAD * 2;
  const h = rect.h + PAD * 2;
  const below = y + h + 64 < window.innerHeight;
  const capTop = below ? y + h + 10 : Math.max(8, y - 54);
  const capLeft = Math.min(Math.max(12, x), window.innerWidth - 332);

  return (
    <div
      className="spotlight pointer-events-none fixed inset-0 z-[45]"
      data-leaving={leaving || undefined}
      aria-live="polite"
    >
      <svg className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <mask id="agent-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={18} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(15 30 51 / 0.42)" mask="url(#agent-spotlight-mask)" />
        <rect x={x} y={y} width={w} height={h} rx={18} fill="none" stroke="var(--color-brand)" strokeWidth={2} className="spotlight-ring" />
      </svg>
      <div
        className="spotlight-caption pointer-events-auto absolute flex max-w-[320px] items-start gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-[13px] leading-snug text-ink shadow-[var(--shadow-pop)]"
        style={{ top: capTop, left: capLeft }}
        role="status"
      >
        <span className="mt-1 size-2 shrink-0 rounded-full bg-brand" aria-hidden />
        <span className="min-w-0 flex-1">{action.caption}</span>
        <button
          type="button"
          onClick={() => setLeaving(true)}
          className="pressable -mr-1 -mt-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-3 hover:bg-canvas hover:text-ink"
          aria-label="Dismiss highlight"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
