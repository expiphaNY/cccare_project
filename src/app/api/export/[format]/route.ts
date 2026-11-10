import { authorize } from "@/lib/access";
import { getPatientBundle, logAccess, resolveShare, type PatientBundle } from "@/lib/data";
import { buildFhirBundle } from "@/lib/export/fhir";
import { buildHtml } from "@/lib/export/html";
import { buildPdf } from "@/lib/export/pdf";
import { fmtDateTime, fullName } from "@/lib/format";
import { getStore } from "@/lib/store";
import type { Actor, Share } from "@/lib/types";
import { EXERCISES } from "@/lib/types";

const FORMATS = ["pdf", "html", "fhir", "csv"] as const;
type Format = (typeof FORMATS)[number];

function fileStem(b: PatientBundle) {
  const d = new Date().toISOString().slice(0, 10);
  return `${b.patient.lastName}-${b.patient.firstName}-EMG-${d}`.replace(/[^\w.-]+/g, "_");
}

/**
 * GET /api/export/pdf|html|fhir?patient=<id>&as=clinician|patient   (owner / care team)
 * GET /api/export/pdf|html|fhir?token=<share token>                  (share recipient)
 * GET /api/export/csv?rid=<recording id>&as=…|token=…                (raw samples of one set)
 * Optional: &raw=1 adds raw + rectified waveforms to the FHIR bundle.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/export/[format]">) {
  const { format } = await ctx.params;
  if (!FORMATS.includes(format as Format)) return Response.json({ error: "Unknown format" }, { status: 404 });
  const params = new URL(req.url).searchParams;
  const store = await getStore();
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

  if (format === "csv") {
    const rec = await store.getRecording(params.get("rid") ?? "");
    if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
    const grant = await authorize(params, rec.patientId);
    if (!grant || !grant.includeRaw || (grant.sessionIds && !grant.sessionIds.has(rec.sessionId)))
      return Response.json({ error: "Not authorised" }, { status: 403 });
    const sig = await store.getSignal(rec.id);
    if (!sig) return Response.json({ error: "Signal unavailable" }, { status: 404 });
    const lines = [
      `# patient_id=${rec.patientId},recording_id=${rec.id},exercise=${EXERCISES[rec.exercise].name},muscle=${rec.muscle},side=${rec.side},set=${rec.setNumber},recorded_at=${rec.recordedAt},fs_hz=${sig.sampleRateHz},units=mV,source=${rec.source}`,
      `sample,timestamp,t_s,raw_mV,rectified_mV,envelope_mV${sig.motion ? ",accel_x_g,accel_y_g,accel_z_g" : ""}`,
    ];
    const cell = (a: Float32Array, i: number) => (a.length ? a[i].toFixed(6) : "");
    const m = sig.motion;
    const t0 = Date.parse(rec.recordedAt);
    for (let i = 0; i < sig.envelope.length; i++)
      lines.push(
        `${i},${new Date(t0 + (i * 1000) / sig.sampleRateHz).toISOString()},${(i / sig.sampleRateHz).toFixed(4)},${cell(sig.raw, i)},${cell(sig.rectified, i)},${sig.envelope[i].toFixed(6)}${
          m ? `,${m.x[i].toFixed(4)},${m.y[i].toFixed(4)},${m.z[i].toFixed(4)}` : ""
        }`,
      );
    await logAccess(rec.patientId, grant.actor, "export_csv", `Downloaded raw samples for ${EXERCISES[rec.exercise].name}, set ${rec.setNumber} (${fmtDateTime(rec.recordedAt)}).`);
    return new Response(lines.join("\n"), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${rec.id}.csv"` },
    });
  }

  let bundle: PatientBundle | null = null;
  let actor: Actor;
  let share: Share | null = null;
  let includeRaw = false;
  const token = params.get("token");
  if (token) {
    const r = await resolveShare(token);
    if (!r.bundle || !r.share) return Response.json({ error: "This link has expired or was revoked." }, { status: 403 });
    bundle = r.bundle;
    share = r.share;
    actor = { role: "recipient", name: r.share.recipient };
    includeRaw = r.share.includeRaw && params.get("raw") === "1";
  } else {
    const pid = params.get("patient") ?? "";
    const grant = await authorize(params, pid);
    if (!grant) return Response.json({ error: "Not authorised" }, { status: 403 });
    bundle = await getPatientBundle(pid);
    actor = grant.actor;
    includeRaw = params.get("raw") === "1";
  }
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });

  const getSignal = (id: string) => store.getSignal(id);
  const scopeText = share ? (share.scope === "full" ? "full profile" : `${bundle.sessions.length} shared session(s)`) : "full profile";
  const by = actor.role === "recipient" ? `${actor.name} (via share link)` : actor.name;

  if (format === "fhir") {
    const fhir = await buildFhirBundle(bundle, getSignal, { includeRaw, generatedBy: by, share });
    await logAccess(bundle.patient.id, actor, "export_fhir", `Exported FHIR R4 bundle (${scopeText}${includeRaw ? ", incl. raw signals" : ""}).`);
    return new Response(JSON.stringify(fhir, null, 2), {
      headers: { ...headers, "Content-Type": "application/fhir+json; charset=utf-8", "Content-Disposition": `attachment; filename="${fileStem(bundle)}.fhir.json"` },
    });
  }

  if (format === "html") {
    const html = await buildHtml(bundle, getSignal, { generatedBy: by, share });
    await logAccess(bundle.patient.id, actor, "export_html", `Downloaded interactive HTML report (${scopeText}).`);
    return new Response(html, {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${fileStem(bundle)}.html"` },
    });
  }

  const audit = share ? [] : await store.listAudit(bundle.patient.id);
  const pdf = await buildPdf(bundle, getSignal, { generatedBy: by, share, audit });
  await logAccess(bundle.patient.id, actor, "export_pdf", `Downloaded PDF report of ${fullName(bundle.patient)} (${scopeText}).`);
  return new Response(Buffer.from(pdf), {
    headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileStem(bundle)}.pdf"` },
  });
}
