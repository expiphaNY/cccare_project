// =============================================================================
// page.tsx : WEIGHT SETTINGS PAGE
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Where the clinic edits the list of weights (kg or lb) that the recorder offers for each set.
// =============================================================================

import { WeightSettingsForm } from "@/components/WeightSettingsForm";
import { PageContainer } from "@/components/ui";
import { getStore } from "@/lib/store";

export const metadata = { title: "Weights" };

export default async function WeightSettingsPage() {
  const store = await getStore();
  const weights = await store.getWeightSettings();
  return (
    <PageContainer className="pt-8">
      <p className="eyebrow">Northside Rehabilitation Clinic</p>
      <h1 className="display mt-1 text-[32px] font-semibold">Weights</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-2">
        The weights offered when recording a set. Each set saves the weight it used, and MyoMinion recommends the next step from this list.
        Stored in {store.kind === "mongodb" ? "MongoDB (settings collection)" : "the local file store"}.
      </p>
      <div className="mt-6 max-w-3xl">
        <WeightSettingsForm initial={weights} />
      </div>
    </PageContainer>
  );
}
