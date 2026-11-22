// =============================================================================
// page.tsx : DRAFTS PAGE FOR THE WHOLE CASELOAD
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Every assistant draft that is still waiting for approval across all patients, newest first,
//   with a filter by patient.
// =============================================================================

import { PageContainer } from "@/components/ui";
import { PendingSuggestionsPanel, type PendingRow } from "@/components/PendingSuggestionsPanel";
import { agentTarget } from "@/lib/agent/target";
import { fullName, initials } from "@/lib/format";
import { getStore } from "@/lib/store";

export const metadata = { title: "Drafts" };

export default async function PendingSuggestionsPage() {
  const store = await getStore();
  const [patients, all] = await Promise.all([store.listPatients(), store.listSuggestions()]);
  const byId = new Map(patients.map((p) => [p.id, p]));
  // Drop suggestions whose patient no longer exists rather than render a nameless card.
  const rows: PendingRow[] = all
    .filter((s) => s.status === "pending" && byId.has(s.patientId))
    .map((s) => {
      const p = byId.get(s.patientId)!;
      return { suggestion: s, patient: { id: p.id, name: fullName(p), initials: initials(p) } };
    });

  return (
    <PageContainer className="pt-8">
      <p className="eyebrow">Northside Rehabilitation Clinic</p>
      <h1 className="display mt-1 text-[32px] font-semibold">Drafts to approve</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-2">
        Session notes and working-weight changes MyoMinion drafted for you. Nothing is applied until you approve it.
      </p>
      <div className="mt-6 max-w-3xl" {...agentTarget("pending-suggestions", "Pending drafts across all patients")}>
        <PendingSuggestionsPanel rows={rows} />
      </div>
    </PageContainer>
  );
}
