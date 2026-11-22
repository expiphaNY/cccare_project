// =============================================================================
// layout.tsx : FRAME AROUND EVERY CLINICIAN PAGE
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Wraps all pages under /doctor with the top navigation bar and the assistant (MyoMinion) button,
//   so they appear once and stay put while the page below changes.
// =============================================================================

import { Suspense } from "react";
import { AgentDock } from "@/components/agent/AgentDock";
import { ClinicianHeader } from "@/components/nav";

export default function DoctorLayout({ children }: LayoutProps<"/doctor">) {
  return (
    <>
      <ClinicianHeader />
      {children}
      <Suspense fallback={null}>
        <AgentDock role="clinician" />
      </Suspense>
    </>
  );
}
