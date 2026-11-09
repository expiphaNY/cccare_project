import { ClinicianHeader } from "@/components/nav";

export default function DoctorLayout({ children }: LayoutProps<"/doctor">) {
  return (
    <>
      <ClinicianHeader />
      {children}
    </>
  );
}
