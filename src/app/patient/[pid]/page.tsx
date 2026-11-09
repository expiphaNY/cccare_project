import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarCheck, Eye, Flag, HeartPulse, Layers, MessageSquareText, ShieldCheck } from "lucide-react";
import { ExerciseCards } from "@/components/ExerciseCards";
import { TrendPanel } from "@/components/charts/TrendPanel";
import { WhoCanSee } from "@/components/transparency";
import { Card, CardHeader, cx } from "@/components/ui";
import { sessionsPerWeek } from "@/lib/analytics";
import { accessSummary, getPatientBundle, patientActor, logAccess, clinicianById } from "@/lib/data";
import { shouldLog } from "@/lib/access";
import { fmtDate, fmtShortDate, msSince, relTime } from "@/lib/format";
import { getStore } from "@/lib/store";
import { EXERCISES } from "@/lib/types";
import { summaries, trendProps } from "@/lib/viewmodels";

export default async function PatientHome({ params }: PageProps<"/patient/[pid]">) {
  const { pid } = await params;
  const b = await getPatientBundle(pid);
  if (!b) notFound();
  const { patient: p, sessions, recordings } = b;
  if (shouldLog(`pat|${pid}|profile`, 10 * 60_000)) await logAccess(pid, patientActor(p), "profile_viewed", "Opened My progress.");
  const store = await getStore();
  const [audit, who] = await Promise.all([store.listAudit(pid), accessSummary(p)]);
  const lastOther = audit.find((e) => e.actor.role !== "patient" && e.actor.role !== "device");
  const sums = summaries(p, recordings);
  const main = sums[0];
  const clin = clinicianById(p.clinicianId);
  const base = `/patient/${pid}`;
  const lastNote = [...sessions].reverse().find((s) => s.notes);
  const pain = sessions.filter((s) => s.painScore != null);
  const first = sessions[0];
  const daysIn = first ? Math.round(msSince(first.startedAt) / 864e5) : 0;

  const headline = (() => {
    if (!main) return { big: "Welcome", small: "Your first session will show up here." };
    const ratio = main.latest / main.baseline;
    const muscle = EXERCISES[main.exercise].muscle.toLowerCase();
    if (main.status === "declining")
      return {
        big: "A small dip — that’s normal.",
        small: `Your ${muscle} effort dropped a little in the last sessions, but it’s still ${(ratio * 100 - 100).toFixed(0)}% above where you started. Your clinician has been notified.`,
      };
    if (ratio >= 1.5)
      return {
        big: `${ratio.toFixed(1)}× stronger signal`,
        small: `Your ${muscle} now produces ${ratio.toFixed(1)} times the muscle activity it did on day one.`,
      };
    return {
      big: `${main.changePct >= 0 ? "+" : ""}${main.changePct.toFixed(0)}% since you started`,
      small: `That’s the change in how strongly your ${muscle} activates during ${EXERCISES[main.exercise].name.toLowerCase()}.`,
    };
  })();

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-[#0b63ce] via-[#1f74da] to-[#3d8ef0] px-6 py-8 text-white shadow-[var(--shadow-card)] sm:px-10 sm:py-10">
        <div className="absolute -right-16 -top-24 size-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <p className="text-sm font-medium text-white/85">Hi {p.firstName} · day {daysIn} of your recovery</p>
        <h1 className="display mt-2 max-w-2xl text-[34px] font-semibold sm:text-[46px]">{headline.big}</h1>
        <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-white/90">{headline.small}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={`${base}/compare`} className="pressable inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-brand hover:bg-white/90">
            <Layers className="size-4" aria-hidden /> See start vs now
          </Link>
          <Link href={`${base}/sessions`} className="pressable inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-medium text-white hover:bg-white/25">
            All sessions <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat Icon={CalendarCheck} label="Sessions done" value={String(sessions.length)} sub={`${sessionsPerWeek(sessions).toFixed(1)} per week`} />
        <MiniStat
          Icon={HeartPulse}
          label="Pain before exercise"
          value={pain.length ? `${pain[0].painScore} → ${pain[pain.length - 1].painScore}` : "–"}
          sub="Out of 10, from your check-ins"
        />
        <MiniStat Icon={Flag} label="Your goal" value="" sub={p.goal} />
        <MiniStat
          Icon={Eye}
          label="Last viewed by someone else"
          value={lastOther ? relTime(lastOther.at) : "Never"}
          sub={lastOther ? lastOther.actor.name : "Only you so far"}
          href={`${base}/privacy`}
        />
      </div>

      <ExerciseCards summaries={sums} compareHref={`${base}/compare`} audience="patient" />

      {sessions.length > 0 && (
        <Card>
          <CardHeader
            title="Your progress"
            subtitle="Each dot is one session — your strongest set. Higher means your muscle is switching on more strongly. Tap a dot to see that day."
          />
          <div className="pt-3">
            <TrendPanel {...trendProps(p, recordings, ["peakEnvelope"], sessions)} audience="patient" sessionHref={`${base}/sessions`} />
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            eyebrow="Your data"
            title="Who can see your data right now"
            action={
              <Link href={`${base}/privacy`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                Manage <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          <div className="px-5 pb-5 pt-4 sm:px-6">
            <WhoCanSee people={who.people} />
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-brand-tint px-3 py-2.5 text-[13px] text-ink-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              Nobody else can see it. Every time someone opens your record, it shows up in your access log.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader eyebrow="From your clinician" title={clin ? clin.name : "Your clinician"} />
          <div className="px-5 pb-5 pt-4 sm:px-6">
            {lastNote ? (
              <div className="flex gap-3">
                <MessageSquareText className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                <div>
                  <p className="whitespace-pre-line text-[15px] leading-relaxed">{lastNote.notes}</p>
                  <Link href={`${base}/sessions/${lastNote.id}`} className="mt-1 inline-block text-[12px] font-medium text-brand hover:underline">
                    From your session on {fmtShortDate(lastNote.startedAt)}
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-2">No notes yet.</p>
            )}
            {sessions.length > 0 && (
              <p className="mt-5 border-t border-line pt-4 text-[13px] text-ink-2">
                Last session: <b className="text-ink">{fmtDate(sessions[sessions.length - 1].startedAt)}</b>
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function MiniStat({
  Icon,
  label,
  value,
  sub,
  href,
}: {
  Icon: typeof Eye;
  label: string;
  value: string;
  sub: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <Icon className="size-4 text-brand" aria-hidden /> {label}
      </div>
      {value && <div className="display tabular mt-2 text-[24px] font-semibold">{value}</div>}
      <div className={cx("text-[13px] text-ink-2", value ? "mt-0.5" : "mt-2 text-[15px] font-medium leading-snug text-ink")}>{sub}</div>
    </>
  );
  return href ? (
    <Link href={href} className="pressable rounded-card border border-line bg-white p-5 shadow-[var(--shadow-card)] hover:border-brand/40">
      {inner}
    </Link>
  ) : (
    <Card className="p-5">{inner}</Card>
  );
}
