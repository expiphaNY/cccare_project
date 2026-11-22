import { authorize, shouldLog } from "@/lib/access";
import { logAccess } from "@/lib/data";
import { getStore } from "@/lib/store";
import { EXERCISES, measuredChannels } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";

const b64 = (a: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");

/**
 * Sends the full waveform for one set to the page.
 * Safety steps, in order:
 *   1. Check the set exists.
 *   2. Check the person is allowed to see this patient (and this session).
 *   3. Write who looked at what in the audit log (once a minute at most).
 *   4. Leave out the raw signal if the share link does not allow it.
 * The numbers are packed as compact text (base64) to keep the download small.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/signal/[rid]">) {
  const { rid } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const store = await getStore();
  const rec = await store.getRecording(rid);
  if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
  // Step 2: who is asking?
  const grant = await authorize(params, rec.patientId);
  if (!grant || (grant.sessionIds && !grant.sessionIds.has(rec.sessionId)))
    return Response.json({ error: "Not authorised" }, { status: 403 });

  const sig = await store.getSignal(rid);
  if (!sig) return Response.json({ error: "Signal unavailable" }, { status: 404 });

  // Step 3: audit log.
  const purpose = params.get("ctx") === "compare" ? "comparison_viewed" : "signal_viewed";
  const key = `${grant.actor.name}|${rec.patientId}|${purpose}|${purpose === "signal_viewed" ? rid : ""}`;
  if (shouldLog(key)) {
    await logAccess(
      rec.patientId,
      grant.actor,
      purpose,
      purpose === "comparison_viewed"
        ? "Compared recordings over time."
        : `Opened signals for ${EXERCISES[rec.exercise].name}, set ${rec.setNumber} (${fmtDateTime(rec.recordedAt)}).`,
    );
  }

  return Response.json(
    {
      id: rid,
      fs: sig.sampleRateHz,
      n: sig.envelope.length,
      units: rec.units,
      channels: measuredChannels(rec),
      envelope: b64(sig.envelope),
      // Step 4: raw data only goes to people who are allowed it.
      rectified: grant.includeRaw && sig.rectified.length ? b64(sig.rectified) : null,
      raw: grant.includeRaw && sig.raw.length ? b64(sig.raw) : null,
      motion: sig.motion ? { x: b64(sig.motion.x), y: b64(sig.motion.y), z: b64(sig.motion.z) } : null,
    },
    { headers: { "Cache-Control": "private, no-store" } }, // tells browsers and caches not to keep a copy
  );
}
