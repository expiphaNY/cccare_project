// =============================================================================
// route.ts : DEMO SIGNAL LIST (STATIC DEMO BUILD ONLY)
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Copied to src/app/demo-signals.json/route.ts by scripts/build-pages.mjs, only for the static demo build.
//   It cannot live in src/app permanently: route segment settings such as `dynamic` are rejected when Cache
//   Components is on (normal builds). It lists each demo recording's settings so the browser can regenerate it.
// =============================================================================

import { getStore } from "@/lib/store";
import { measuredChannels } from "@/lib/types";
import type { DemoManifest } from "@/lib/demo/manifest";

export const dynamic = "force-static";

export async function GET() {
  const store = await getStore();
  const manifest: DemoManifest = { recordings: {}, shareRaw: {} };
  for (const p of await store.listPatients()) {
    for (const r of await store.listRecordings(p.id))
      if (r.synth) manifest.recordings[r.id] = { fs: r.sampleRateHz, synth: r.synth, channels: measuredChannels(r) };
    for (const s of await store.listShares(p.id)) manifest.shareRaw[s.token] = s.includeRaw;
  }
  return Response.json(manifest);
}
