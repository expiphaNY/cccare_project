import { notFound } from "next/navigation";
import { CompareTool } from "@/components/CompareTool";
import { getPatientBundle } from "@/lib/data";
import { compareRecordings, defaultComparison, exerciseList } from "@/lib/viewmodels";

export default async function DoctorCompare({ params, searchParams }: PageProps<"/doctor/patients/[pid]/compare">) {
  const { pid } = await params;
  const sp = await searchParams;
  const b = await getPatientBundle(pid);
  if (!b) notFound();
  const def = defaultComparison(b.patient, b.recordings);
  const ex = typeof sp.ex === "string" && b.patient.exercises.includes(sp.ex as never) ? sp.ex : def.exercise;
  const ids = typeof sp.ids === "string" ? sp.ids.split(",").filter(Boolean) : ex === def.exercise ? def.ids : [];
  return (
    <CompareTool
      key={`${ex}|${ids.join(",")}`}
      recordings={compareRecordings(b.recordings)}
      exercises={exerciseList(b.patient)}
      access="as=clinician"
      audience="clinician"
      initialExercise={ex}
      initialIds={ids}
    />
  );
}
