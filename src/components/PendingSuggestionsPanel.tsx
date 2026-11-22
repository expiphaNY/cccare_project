// =============================================================================
// PendingSuggestionsPanel.tsx : ALL PENDING DRAFTS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Lists every assistant draft still waiting for approval across the caseload, with a filter by patient, using the same review cards as the per-patient page.
// =============================================================================

"use client";

import { useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import type { Suggestion } from "@/lib/types";
import { PendingItem } from "./SuggestionReview";
import { Segmented } from "./Segmented";
import { Card } from "./ui";

export interface PendingRow {
  suggestion: Suggestion;
  patient: { id: string; name: string; initials: string };
}

/** All pending drafts across the caseload, ranked by date, filterable by patient. */
export function PendingSuggestionsPanel({ rows }: { rows: PendingRow[] }) {
  const [patientId, setPatientId] = useState<string>("all");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");

  // Only patients who have something waiting, so every option leads to a result.
  const patients = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    for (const r of rows) {
      const e = m.get(r.patient.id) ?? { id: r.patient.id, name: r.patient.name, n: 0 };
      e.n++;
      m.set(r.patient.id, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // A decision removes the patient's last pending item from `rows`; fall back to "all".
  const active = patientId !== "all" && !patients.some((p) => p.id === patientId) ? "all" : patientId;

  const shown = useMemo(
    () =>
      rows
        .filter((r) => active === "all" || r.patient.id === active)
        .sort((a, b) => (order === "newest" ? -1 : 1) * a.suggestion.createdAt.localeCompare(b.suggestion.createdAt)),
    [rows, active, order],
  );

  if (!rows.length)
    return (
      <Card className="flex flex-col items-center p-10 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Inbox className="size-5" aria-hidden />
        </span>
        <p className="title mt-3 text-lg font-semibold">You’re all caught up</p>
        <p className="mt-1 max-w-sm text-sm text-ink-2">Nothing is waiting. Drafts appear here when you ask MyoMinion to write a session note or a weight change.</p>
      </Card>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          Patient
          <select
            value={active}
            onChange={(e) => setPatientId(e.target.value)}
            className="min-h-9 cursor-pointer rounded-full border border-line-strong bg-white px-3 text-[13px] text-ink outline-none focus:border-brand"
          >
            <option value="all">All patients ({rows.length})</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.n})
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto">
          <Segmented
            label="Order by date"
            size="sm"
            value={order}
            onChange={setOrder}
            options={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first", title: "Longest-waiting first" },
            ]}
          />
        </div>
      </div>
      <p className="text-[13px] text-ink-2" aria-live="polite">
        {shown.length} pending{active !== "all" ? ` for ${patients.find((p) => p.id === active)?.name}` : ""}
      </p>
      <div className="space-y-3">
        {shown.map((r) => (
          <PendingItem key={r.suggestion.id} s={r.suggestion} patient={r.patient} />
        ))}
      </div>
    </div>
  );
}
