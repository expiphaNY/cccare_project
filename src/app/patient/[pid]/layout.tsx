import { PatientHeader } from "@/components/nav";
import { PageContainer } from "@/components/ui";
import { DEMO } from "@/lib/demo";
import { patientParams } from "@/lib/demo/params";

export const generateStaticParams = DEMO ? patientParams : undefined;

export default function PatientLayout({ children }: LayoutProps<"/patient/[pid]">) {
  return (
    <>
      <PatientHeader />
      <PageContainer className="pt-8"><div className="pb-12 sm:pb-0">{children}</div></PageContainer>
    </>
  );
}
