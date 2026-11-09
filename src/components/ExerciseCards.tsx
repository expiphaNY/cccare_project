import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ExerciseSummary } from "@/lib/analytics";
import { EXERCISES } from "@/lib/types";
import { Sparkline } from "./charts/Sparkline";
import { Card, Delta, StatusBadge } from "./ui";

export function ExerciseCards({
  summaries,
  compareHref,
  audience,
}: {
  summaries: ExerciseSummary[];
  compareHref?: string;
  audience: "clinician" | "patient";
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {summaries.map((s) => {
        const ex = EXERCISES[s.exercise];
        return (
          <Card key={s.exercise} className="flex flex-col p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">{ex.muscle}</div>
                <h3 className="title mt-0.5 text-[17px] font-semibold">{ex.name}</h3>
              </div>
              <StatusBadge status={s.status} audience={audience} />
            </div>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div className="grid grid-cols-3 gap-5">
                <div>
                  <div className="text-[12px] text-ink-2">{audience === "patient" ? "Start" : "Baseline"}</div>
                  <div className="tabular text-lg font-semibold text-ink-2">{s.baseline.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-ink-2">{audience === "patient" ? "Now" : "Latest"}</div>
                  <div className="display tabular text-[26px] font-semibold leading-none">
                    {s.latest.toFixed(2)}
                    <span className="ml-0.5 text-sm font-normal text-ink-3">mV</span>
                  </div>
                </div>
                <div>
                  <div className="text-[12px] text-ink-2">Change</div>
                  <div className="text-lg">
                    <Delta value={s.changePct} />
                  </div>
                </div>
              </div>
              <Sparkline values={s.points.map((p) => p.value)} width={110} height={40} color={s.status === "declining" ? "#9a5500" : "#0b63ce"} />
            </div>
            {compareHref && (
            <Link
              href={`${compareHref}?ex=${s.exercise}&ids=${s.baselineRecordingId},${s.latestRecordingId}`}
              className="mt-4 inline-flex items-center gap-1 self-start text-[13px] font-medium text-brand hover:underline"
            >
              {audience === "patient" ? "See start vs now layered" : "Overlay baseline vs latest"} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            )}
          </Card>
        );
      })}
    </div>
  );
}
