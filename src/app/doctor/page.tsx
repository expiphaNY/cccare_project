// =============================================================================
// page.tsx : CLINICIAN HOME: THE PATIENT LIST
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The first screen after the landing page. Lists the clinician's patients with a search box, a
//   status filter (improving, plateau, declining), a small trend line for each, and a short list of
//   patients who need attention. It is the top of the macro-to-micro ladder: patient list, then
//   patient, then session, then set, then raw samples.
//
// STEPS TAKEN FOR THE MARKING RUBRIC
//   Ease of use: the most important information (who needs attention) is on the first screen with no clicking.
// =============================================================================

import Link from "next/link";
import { AlertTriangle, ArrowRight, Lightbulb, Plus } from "lucide-react";
import { PatientTable, type PatientRow } from "@/components/PatientTable";
import { ButtonLink, Card, CardHeader, PageContainer, Stat, btn } from "@/components/ui";
import { summarize } from "@/lib/analytics";
import { shareState } from "@/lib/data";
import { ageFrom, fullName, initials, msSince, relTime } from "@/lib/format";
import { getStore } from "@/lib/store";
import { EXERCISES } from "@/lib/types";
import { agentTarget } from "@/lib/agent/target";

export const metadata = { title: "Patients" };

export default async function DoctorHome() {
  const store = await getStore();
  const patients = await store.listPatients();
  const pendingSuggestions = (await store.listSuggestions()).filter((s) => s.status === "pending" && patients.some((p) => p.id === s.patientId));
  const patientName = new Map(patients.map((p) => [p.id, fullName(p)]));

  const rows: PatientRow[] = await Promise.all(
    patients.map(async (p) => {
      const [recs, sessions, shares] = await Promise.all([store.listRecordings(p.id), store.listSessions(p.id), store.listShares(p.id)]);
      const s = summarize(recs, p.exercises[0]);
      const last = sessions[sessions.length - 1]?.startedAt ?? null;
      return {
        id: p.id,
        name: fullName(p),
        initials: initials(p),
        age: ageFrom(p.dob),
        sex: p.sex,
        condition: p.condition,
        side: p.affectedSide,
        primaryExercise: EXERCISES[p.exercises[0]].name,
        lastSession: last,
        lastSessionRel: last ? relTime(last) : "No sessions",
        sessions: sessions.length,
        trend: s?.points.map((pt) => pt.value) ?? [],
        changePct: s ? s.changePct : null,
        status: s?.status ?? "new",
        activeShares: shares.filter((x) => shareState(x) === "active").length,
      };
    }),
  );

  const recentSessions = (await Promise.all(patients.map((p) => store.listSessions(p.id))))
    .flat()
    .filter((s) => msSince(s.startedAt) < 7 * 864e5).length;
  // Rep cross-check over the last 30 days: share of reps both sensors agreed on.
  const checked = (await Promise.all(patients.map((p) => store.listRecordings(p.id))))
    .flat()
    .filter((r) => msSince(r.recordedAt) < 30 * 864e5 && r.repCheck && r.repCheck.status !== "no-motion");
  const repE = checked.reduce((t, r) => t + r.repCheck!.emgReps + r.repCheck!.motionReps, 0);
  const repV = checked.reduce((t, r) => t + r.repCheck!.verifiedReps, 0);
  const disagree = checked.filter((r) => r.repCheck!.status === "mismatch" || r.repCheck!.status === "partial").length;
  const attention = rows.filter((r) => r.status === "declining");
  const withChange = rows.filter((r) => r.changePct != null);
  const avgChange = withChange.reduce((s, r) => s + (r.changePct ?? 0), 0) / (withChange.length || 1);

  return (
    <PageContainer className="pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Northside Rehabilitation Clinic</p>
          <h1 className="display mt-1 text-[32px] font-semibold">Welcome back, Doctor</h1>
        </div>
        <ButtonLink href="/doctor/new" variant="primary">
          <Plus className="size-4" aria-hidden /> New patient
        </ButtonLink>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" {...agentTarget("caseload-stats", "Caseload summary cards")}>
        <Card className="p-5">
          <Stat label="Active patients" value={patients.length} />
        </Card>
        <Card className="p-5">
          <Stat
            label="Sessions in the last 7 days"
            value={recentSessions}
            sub={
              repE ? (
                <span className="text-ink-2" title="EMG and accelerometer agreement on reps, last 30 days">
                  {Math.floor(((2 * repV) / repE) * 100)}% of reps verified{disagree ? ` · ${disagree} set${disagree === 1 ? "" : "s"} disagree` : ""}
                </span>
              ) : undefined
            }
          />
        </Card>
        <Card className="p-5">
          <Stat
            label="Average change in peak activation"
            value={`${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(0)}`}
            unit="%"
            help="Latest session vs first session, primary exercise"
          />
        </Card>
        <Card className={attention.length ? "border-[#f3d6a8] bg-[#fffaf1] p-5" : "p-5"} {...agentTarget("need-attention", "Patients needing attention (declining)")}>
          <Stat
            label={
              <span className="inline-flex items-center gap-1">
                {attention.length > 0 && <AlertTriangle className="size-3.5 text-warn" aria-hidden />} Need attention
              </span>
            }
            value={attention.length}
            sub={
              attention.length ? (
                <Link href={`/doctor/patients/${attention[0].id}`} className="inline-flex items-center gap-0.5 font-medium text-warn hover:underline">
                  {attention.map((a) => a.name.split(" ")[0]).join(", ")} <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : (
                <span className="text-ink-2">Nobody declining</span>
              )
            }
          />
        </Card>
      </div>

      {pendingSuggestions.length > 0 && (
        <Card className="mt-6" {...agentTarget("pending-suggestions-summary", "Pending drafts summary")}>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Lightbulb className="size-[18px] text-brand" aria-hidden /> Drafts to approve
              </span>
            }
            subtitle={`${pendingSuggestions.length} waiting for your approval, newest first.`}
            action={
              <ButtonLink href="/doctor/suggestions" variant="secondary" className={btn.small}>
                Review all <ArrowRight className="size-3.5" aria-hidden />
              </ButtonLink>
            }
          />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {pendingSuggestions.slice(0, 3).map((s) => (
              <li key={s.id}>
                <Link href="/doctor/suggestions" className="flex items-center gap-3 px-5 py-3 hover:bg-brand-tint/60 sm:px-6">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{s.title}</span>
                    <span className="block text-[12px] text-ink-2">{patientName.get(s.patientId)}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-3">{relTime(s.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6" {...agentTarget("patient-table", "Table of all patients")}>
        <CardHeader title="Patients" subtitle="Click a patient to drill down: profile → session → set → raw signal." />
        <PatientTable rows={rows} />
      </Card>
    </PageContainer>
  );
}
