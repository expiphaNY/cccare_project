"use client";

import { useEffect, useState } from "react";

export interface ClientSignal {
  id: string;
  fs: number;
  n: number;
  envelope: Float32Array;
  rectified: Float32Array | null;
  raw: Float32Array | null;
}

const cache = new Map<string, Promise<ClientSignal>>();

function decode(b64: string | null) {
  if (!b64) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function fetchSignal(id: string, access: string, ctx?: "compare"): Promise<ClientSignal> {
  const key = `${id}|${access}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/api/signal/${encodeURIComponent(id)}?${access}${ctx ? `&ctx=${ctx}` : ""}`).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
      const j = await r.json();
      return {
        id: j.id,
        fs: j.fs,
        n: j.n,
        envelope: decode(j.envelope)!,
        rectified: decode(j.rectified),
        raw: decode(j.raw),
      };
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function useSignal(id: string, access: string) {
  const [state, setState] = useState<{ data?: ClientSignal; error?: string; id?: string }>({});
  useEffect(() => {
    let live = true;
    fetchSignal(id, access).then(
      (data) => live && setState({ data, id }),
      (e: Error) => live && setState({ error: e.message, id }),
    );
    return () => {
      live = false;
    };
  }, [id, access]);
  // Ignore results that belong to a previous id while the new one loads.
  return state.id === id ? state : {};
}

/** Contraction windows from the envelope (same hysteresis as the server). */
export function detectReps(env: Float32Array, fs: number) {
  let peak = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i];
  const on = peak * 0.35;
  const off = peak * 0.2;
  const reps: { start: number; end: number }[] = [];
  let s = -1;
  for (let i = 0; i < env.length; i++) {
    if (s < 0 && env[i] > on) s = i;
    else if (s >= 0 && env[i] < off) {
      if ((i - s) / fs > 0.3) reps.push({ start: s / fs, end: i / fs });
      s = -1;
    }
  }
  if (s >= 0) reps.push({ start: s / fs, end: env.length / fs });
  return reps;
}

/** Block-mean resample (for smooth channels in overlays). */
export function resample(x: Float32Array, fs: number, hz: number) {
  const step = Math.max(1, Math.round(fs / hz));
  const out = new Float32Array(Math.ceil(x.length / step));
  for (let b = 0; b < out.length; b++) {
    let s = 0;
    let c = 0;
    for (let j = b * step; j < Math.min((b + 1) * step, x.length); j++) {
      s += x[j];
      c++;
    }
    out[b] = s / c;
  }
  return { y: out, fs: fs / step };
}
