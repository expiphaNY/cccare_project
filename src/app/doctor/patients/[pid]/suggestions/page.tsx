// =============================================================================
// page.tsx : DRAFTS TAB FOR ONE PATIENT
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Lists the assistant's drafts for this patient (session notes and working-weight changes) waiting
//   for a clinician's approval. Nothing changes until a draft is approved.
// =============================================================================

import { notFound } from "next/navigation";
import { SuggestionReview } from "@/components/SuggestionReview";
import { agentTarget } from "@/lib/agent/target";
import { getStore } from "@/lib/store";

export default async function DoctorSuggestions({ params }: PageProps<"/doctor/patients/[pid]/suggestions">) {
  const { pid } = await params;
  const store = await getStore();
  if (!(await store.getPatient(pid))) notFound();
  const items = await store.listSuggestions(pid);
  return (
    <div className="max-w-3xl" {...agentTarget("suggestion-queue", "Suggestions awaiting approval and reviewed suggestions")}>
      <SuggestionReview items={items} />
    </div>
  );
}
