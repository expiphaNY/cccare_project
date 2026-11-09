import type { Metadata } from "next";
import { Clock, Eye, Link2Off, ShieldCheck } from "lucide-react";
import { CompareTool } from "@/components/CompareTool";
import { ExerciseCards } from "@/components/ExerciseCards";
import { SharedHeader } from "@/components/nav";
import { ExportLinks } from "@/components/privacy";
import { SignalViewer } from "@/components/charts/SignalViewer";
import { TrendPanel } from "@/components/charts/TrendPanel";
import { Avatar, Badge, Card, CardHeader, PageContainer } from "@/components/ui";
import { shouldLog } from "@/lib/access";
import { clinicianById, logAccess, resolveShare, shareState } from "@/lib/data";
import { ageFrom, fmtDate, fmtTime, fullName, initials, relTime } from "@/lib/format";
import { getStore } from "@/lib/store";
import { EXERCISES } from "@/lib/types";
import { compareRecordings, defaultComparison, exerciseList, summaries, trendProps } from "@/lib/viewmodels";

export const metadata: Metadata = { title: "Shared record", referrer: "no-referrer" };

export default async function SharedRecord({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const { share, bundle } = await resolveShare(token);

  if (!share || !bundle) {
    const state = share ? shareState(share) : "unknown";
    return (
      <>
        <SharedHeader />
        <PageContainer className="flex items-center justify-center pt-24">
          <Card className="max-w-md p-8 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-canvas text-ink-2">
              <Link2Off className="size-5" aria-hidden />
            </span>
            <h1 className="title mt-4 text-xl font-semibold">
              {state === "revoked" ? "This link was revoked" : state === "expired" ? "This link has expired" : "Link not found"}
            </h1>
            <p className="mt-2 text-sm text-ink-2">
              Shared health records are only available for a limited time. Ask the person who sent it for a new link.
            </p>
          </Card>
        </PageContainer>
      </>
    );
  }

  const store = await getStore();
  if (shouldLog(`share|${token}`, 30 * 60_000)) {
    await store.updateShare(token, { accessCount: share.accessCount + 1, lastAccessedAt: new Date().toISOString() });
    await logAccess(share.patientId, { role: "recipient", name: share.recipient }, "share_opened", "Opened shared link.");
  }

  const { patient: p, sessions, recordings } = bundle;
  const clin = clinicianById(p.clinicianId);
  const access = `token=${encodeURIComponent(token)}`;
  const def = defaultComparison(p, recordings);
  const lastSessionId = recordings[recordings.length - 1]?.sessionId;
  const inLast = recordings.filter((r) => r.sessionId === lastSessionId);
  const latest = inLast.length ? inLast.reduce((a, b) => (b.metrics.peakEnvelope > a.metrics.peakEnvelope ? b : a)) : null;

  return (
    <>
      <SharedHeader />
      <PageContainer className="space-y-6 pt-6">
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-[#f3d6a8] bg-[#fffaf1] px-4 py-3 text-[13px] text-ink-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <p className="min-w-0 flex-1">
            <b className="text-ink">Confidential health record</b> shared with <b className="text-ink">{share.recipient}</b> by {share.createdBy.name} for “{share.purpose}”.
            Read-only. {share.scope === "full" ? "Entire profile" : `${sessions.length} selected session(s)`}
            {share.includeRaw ? ", including raw signals" : " (summary & envelope only)"}.
          </p>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden /> Expires {relTime(share.expiresAt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Eye className="size-3.5" aria-hidden /> Your visit is recorded and visible to the patient
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Avatar text={initials(p)} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="display text-[28px] font-semibold">{fullName(p)}</h1>
            <p className="text-sm text-ink-2">
              {ageFrom(p.dob)} y · <span className="capitalize">{p.sex}</span> · DOB {fmtDate(p.dob)} · MRN {p.mrn} · Clinician {clin?.name}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="brand">{p.condition}</Badge>
              <Badge className="capitalize">{p.affectedSide} side</Badge>
              <Badge>{sessions.length} sessions</Badge>
            </div>
          </div>
        </div>

        <ExerciseCards summaries={summaries(p, recordings)} audience="clinician" />

        <Card>
          <CardHeader title="Trends" subtitle="One point per session (strongest set)." />
          <div className="pt-3">
            <TrendPanel {...trendProps(p, recordings, ["peakEnvelope", "meanEnvelope", "medianFreqHz", "fatigueIndex"], sessions)} audience="clinician" />
          </div>
        </Card>

        <div>
          <h2 className="title mb-3 text-xl font-semibold">Compare over time</h2>
          <CompareTool
            recordings={compareRecordings(recordings)}
            exercises={exerciseList(p)}
            access={access}
            audience="recipient"
            initialExercise={def.exercise}
            initialIds={def.ids}
          />
        </div>

        {latest && (
          <Card>
            <CardHeader
              eyebrow={`Latest session · ${fmtDate(latest.recordedAt)} ${fmtTime(latest.recordedAt)}`}
              title={`${EXERCISES[latest.exercise].name}, set ${latest.setNumber}`}
              subtitle="Strongest set of the most recent shared session."
            />
            <div className="pt-4">
              <SignalViewer recordingId={latest.id} access={access} audience="recipient" />
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Measurement history" subtitle="Every recorded set in this share." />
          <div className="mt-3 max-h-[480px] overflow-auto border-t border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-white text-left text-[12px] text-ink-2">
                <tr>
                  <th className="px-5 py-2.5 font-medium sm:px-6">Date & time</th>
                  <th className="px-3 py-2.5 font-medium">Exercise</th>
                  <th className="px-3 py-2.5 text-right font-medium">Set</th>
                  <th className="px-3 py-2.5 text-right font-medium">Peak</th>
                  <th className="px-3 py-2.5 text-right font-medium">Mean</th>
                  <th className="px-5 py-2.5 text-right font-medium sm:px-6">MDF</th>
                </tr>
              </thead>
              <tbody>
                {[...recordings].reverse().map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-5 py-2 tabular sm:px-6">
                      {fmtDate(r.recordedAt)} <span className="text-ink-3">{fmtTime(r.recordedAt)}</span>
                    </td>
                    <td className="px-3 py-2">{EXERCISES[r.exercise].name}</td>
                    <td className="px-3 py-2 text-right tabular">{r.setNumber}</td>
                    <td className="px-3 py-2 text-right tabular">{r.metrics.peakEnvelope.toFixed(3)} mV</td>
                    <td className="px-3 py-2 text-right tabular">{r.metrics.meanEnvelope.toFixed(3)} mV</td>
                    <td className="px-5 py-2 text-right tabular sm:px-6">{r.metrics.medianFreqHz.toFixed(0)} Hz</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Download" subtitle="Each download is recorded in the patient’s access log." />
          <div className="px-5 pb-5 pt-4 sm:px-6">
            <ExportLinks query={access} />
          </div>
        </Card>
      </PageContainer>
    </>
  );
}

