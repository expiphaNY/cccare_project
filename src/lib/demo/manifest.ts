// =============================================================================
// manifest.ts : STATIC DEMO ONLY: WHAT THE BROWSER NEEDS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The shape of the small JSON file that lets the browser rebuild each demo recording (its settings and which channels it has), and which share links may see raw signals.
// =============================================================================

import type { ChannelKey, SynthParams } from "@/lib/types";

/**
 * Static demo only: what the browser needs to regenerate each mock recording's
 * signal (they are deterministic), since there is no /api/signal to ask.
 */
export interface DemoManifest {
  recordings: Record<string, { fs: number; synth: SynthParams; channels: ChannelKey[] }>;
  /** Share token -> whether that link may see raw/rectified signals. */
  shareRaw: Record<string, boolean>;
}
