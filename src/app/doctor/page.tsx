import Link from "next/link";
import { AlertTriangle, ArrowRight, Plus } from "lucide-react";
import { PatientTable, type PatientRow } from "@/components/PatientTable";
import { ButtonLink, Card, CardHeader, PageContainer, Stat } from "@/components/ui";
import { summarize } from "@/lib/analytics";
import { shareState } from "@/lib/data";
import { ageFrom, fullName, initials, msSince, relTime } from "@/lib/format";
import { getStore } from "@/lib/store";
import { EXERCISES } from "@/lib/types";

export const metadata = { title: "Patients" };

export default async function DoctorHome() {
  const store = await getStore();
  const patients = await store.listPatients();

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
  const attention = rows.filter((r) => r.status === "declining");
  const withChange = rows.filter((r) => r.changePct != null);
  const avgChange = withChange.reduce((s, r) => s + (r.changePct ?? 0), 0) / (withChange.length || 1);

  return (
    <PageContainer className="pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Northside Rehabilitation Clinic</p>
          <h1 className="display mt-1 text-[32px] font-semibold">Welcome back, Dr. Hart</h1>
        </div>
        <ButtonLink href="/doctor/new" variant="primary">
          <Plus className="size-4" aria-hidden /> New patient
        </ButtonLink>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <Stat label="Active patients" value={patients.length} />
        </Card>
        <Card className="p-5">
          <Stat label="Sessions in the last 7 days" value={recentSessions} />
        </Card>
        <Card className="p-5">
          <Stat
            label="Average change in peak activation"
            value={`${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(0)}`}
            unit="%"
            help="Latest session vs first session, primary exercise"
          />
        </Card>
        <Card className={attention.length ? "border-[#f3d6a8] bg-[#fffaf1] p-5" : "p-5"}>
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

      <Card className="mt-6">
        <CardHeader title="Patients" subtitle="Click a patient to drill down: profile → session → set → raw signal." />
        <PatientTable rows={rows} />
      </Card>
    </PageContainer>
  );
}
