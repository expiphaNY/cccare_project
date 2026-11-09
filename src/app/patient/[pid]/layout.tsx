import { PatientHeader } from "@/components/nav";
import { PageContainer } from "@/components/ui";

export default function PatientLayout({ children }: LayoutProps<"/patient/[pid]">) {
  return (
    <>
      <PatientHeader />
      <PageContainer className="pt-8"><div className="pb-12 sm:pb-0">{children}</div></PageContainer>
    </>
  );
}
