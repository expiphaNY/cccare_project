import { notFound } from "next/navigation";
import { CompareTool } from "@/components/CompareTool";
import { CompareFromQuery } from "@/components/demo/CompareFromQuery";
import { getPatientBundle } from "@/lib/data";
import { DEMO } from "@/lib/demo";
import { compareRecordings, defaultComparison, exerciseList } from "@/lib/viewmodels";

export const metadata = { title: "Compare" };

export default async function PatientCompare({ params, searchParams }: PageProps<"/patient/[pid]/compare">) {
  const { pid } = await params;
  const sp: Record<string, string | string[] | undefined> = DEMO ? {} : await searchParams;
  const b = await getPatientBundle(pid);
  if (!b) notFound();
  const def = defaultComparison(b.patient, b.recordings);
  const ex = typeof sp.ex === "string" && b.patient.exercises.includes(sp.ex as never) ? sp.ex : def.exercise;
  const ids = typeof sp.ids === "string" ? sp.ids.split(",").filter(Boolean) : ex === def.exercise ? def.ids : [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-[30px] font-semibold">Compare days</h1>
        <p className="mt-1 max-w-2xl text-ink-2">
          Layer recordings from different days on top of each other to see how your muscle has changed. Taller curves mean your muscle is switching on more
          strongly.
        </p>
      </div>
      {DEMO ? (
        <CompareFromQuery
          recordings={compareRecordings(b.recordings)}
          exercises={exerciseList(b.patient)}
          access="as=patient"
          audience="patient"
          defaultExercise={def.exercise}
          defaultIds={def.ids}
        />
      ) : (
        <CompareTool
          key={`${ex}|${ids.join(",")}`}
          recordings={compareRecordings(b.recordings)}
          exercises={exerciseList(b.patient)}
          access="as=patient"
          audience="patient"
          initialExercise={ex}
          initialIds={ids}
        />
      )}
    </div>
  );
}
