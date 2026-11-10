import { authorize, shouldLog } from "@/lib/access";
import { logAccess } from "@/lib/data";
import { getStore } from "@/lib/store";
import { EXERCISES, measuredChannels } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";

const b64 = (a: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");

/**
 * Full-resolution signal for one set, as base64 little-endian float32 arrays.
 * Raw and rectified channels are withheld from share links that exclude raw data.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/signal/[rid]">) {
  const { rid } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const store = await getStore();
  const rec = await store.getRecording(rid);
  if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
  const grant = await authorize(params, rec.patientId);
  if (!grant || (grant.sessionIds && !grant.sessionIds.has(rec.sessionId)))
    return Response.json({ error: "Not authorised" }, { status: 403 });

  const sig = await store.getSignal(rid);
  if (!sig) return Response.json({ error: "Signal unavailable" }, { status: 404 });

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
      rectified: grant.includeRaw && sig.rectified.length ? b64(sig.rectified) : null,
      raw: grant.includeRaw && sig.raw.length ? b64(sig.raw) : null,
      motion: sig.motion ? { x: b64(sig.motion.x), y: b64(sig.motion.y), z: b64(sig.motion.z) } : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
