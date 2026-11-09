import { Breadcrumbs, Card, PageContainer } from "@/components/ui";
import { NewPatientForm } from "@/components/NewPatientForm";
import { EXERCISES } from "@/lib/types";

export const metadata = { title: "New patient" };

export default function NewPatient() {
  return (
    <PageContainer className="max-w-3xl pt-6">
      <Breadcrumbs items={[{ label: "Patients", href: "/doctor" }, { label: "New patient" }]} />
      <h1 className="display mt-3 text-[28px] font-semibold">New patient profile</h1>
      <p className="mt-1 text-sm text-ink-2">Only what’s needed for care. The patient will see everything entered here.</p>
      <Card className="mt-6 p-6">
        <NewPatientForm exercises={Object.entries(EXERCISES).map(([key, v]) => ({ key, ...v }))} />
      </Card>
    </PageContainer>
  );
}
