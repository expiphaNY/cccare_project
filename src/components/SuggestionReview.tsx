// =============================================================================
// SuggestionReview.tsx : APPROVAL CARDS FOR ASSISTANT DRAFTS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Shows each draft (a session note or a weight change) with the reason, and lets a clinician apply or reject it. Nothing the assistant drafts is applied until this happens.
// =============================================================================

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ChevronRight, Dumbbell, NotebookPen, Pencil, X } from "lucide-react";
import { agentTarget } from "@/lib/agent/target";
import { reviewSuggestionAction } from "@/app/actions";
import { DEMO, DEMO_MSG } from "@/lib/demo";
import { fmtDateTime } from "@/lib/format";
import { fmtLoad, type Suggestion } from "@/lib/types";
import { Avatar, Badge, Card, btn, cx } from "./ui";
import { Markdown, RichText } from "./agent/Markdown";

/** Clinician approval queue for assistant drafts (session notes, weight changes). */
export function SuggestionReview({ items }: { items: Suggestion[] }) {
  const pending = items.filter((s) => s.status === "pending");
  const reviewed = items.filter((s) => s.status !== "pending");
  return (
    <div className="space-y-6">
      <section>
        <h2 className="title text-[17px] font-semibold">Awaiting your approval</h2>
        <p className="mt-0.5 text-sm text-ink-2">Nothing changes until you approve. A note is added to its session; a weight change becomes the prescribed working weight.</p>
        <div className="mt-3 space-y-3">
          {pending.length === 0 ? (
            <Card className="p-6 text-center text-sm text-ink-2">Nothing waiting. Ask MyoMinion to draft a session note or a weight change and it appears here.</Card>
          ) : (
            pending.map((s) => <PendingItem key={s.id} s={s} />)
          )}
        </div>
      </section>
      {reviewed.length > 0 && (
        <section>
          <h2 className="title text-[17px] font-semibold">Reviewed</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
            {reviewed.map((s) => (
              <li key={s.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium">{s.title}</span>
                  <Badge tone={s.status === "approved" ? "good" : "neutral"}>{s.status === "approved" ? (s.kind === "note" ? "Approved · added to notes" : s.kind === "load" ? "Approved · weight updated" : "Approved") : "Declined"}</Badge>
                  <span className="ml-auto text-[12px] text-ink-3">{s.reviewedAt ? fmtDateTime(s.reviewedAt) : ""}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-2">
                  <RichText text={s.body} />
                </p>
                {s.reviewNote && <p className="mt-1 text-[12px] text-ink-3">Your comment: {s.reviewNote}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** `patient` adds a name + link header, for lists that span several patients. */
export function PendingItem({ s, patient }: { s: Suggestion; patient?: { name: string; initials: string } }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [body, setBody] = useState(s.body);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const decide = (decision: "approved" | "rejected") =>
    start(async () => {
      setError(null);
      if (DEMO) return setError(DEMO_MSG);
      const r = await reviewSuggestionAction({ patientId: s.patientId, id: s.id, decision, title, body, note });
      if (!r.ok) setError(r.error);
    });

  const field = "w-full rounded-xl border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15";
  return (
    <Card className="p-5" {...agentTarget(`suggestion-${s.id}`, `Pending draft “${s.title}”`)}>
      {patient && (
        <Link href={`/doctor/patients/${s.patientId}/suggestions`} className="mb-3 inline-flex items-center gap-2 rounded-full pr-2 hover:bg-brand-soft">
          <Avatar text={patient.initials} size="sm" />
          <span className="text-[14px] font-medium text-ink">{patient.name}</span>
          <ChevronRight className="size-3.5 text-ink-3" aria-hidden />
        </Link>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        <Badge tone="warn">Pending</Badge>
        <Badge>
          {s.kind === "load" ? <Dumbbell className="size-3" aria-hidden /> : <NotebookPen className="size-3" aria-hidden />}
          {s.kind === "load" ? `Weight change${s.proposedLoad ? ` → ${fmtLoad(s.proposedLoad)}` : ""}` : s.kind === "note" ? "Session note" : "Draft"}
        </Badge>
        <span>
          Drafted {fmtDateTime(s.createdAt)} by MyoMinion for {s.requestedBy.name}
        </span>
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <label className="block text-[12px] font-medium text-ink-2">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={cx(field, "mt-1")} />
          </label>
          <label className="block text-[12px] font-medium text-ink-2">
            {s.kind === "note" ? "Note text (added to the session notes)" : "Details"}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={cx(field, "mt-1 resize-y")} />
          </label>
        </div>
      ) : (
        <div className="mt-2">
          <h3 className="title text-[16px] font-semibold">{title}</h3>
          <div className="mt-1">
            <Markdown text={body} />
          </div>
        </div>
      )}
      <div className="mt-3 rounded-xl bg-canvas px-3 py-2 text-[13px] text-ink-2">
        <span className="font-medium text-ink">Based on:</span> {s.rationale || "No rationale given."}
      </div>
      <label className="mt-3 block text-[12px] font-medium text-ink-2">
        Review comment (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kept with the draft in the record" className={cx(field, "mt-1")} />
      </label>
      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => decide("approved")} className={btn.primary}>
          <Check className="size-4" aria-hidden /> {pending ? "Saving…" : s.kind === "note" ? "Approve and add to notes" : s.kind === "load" ? "Approve weight change" : "Approve"}
        </button>
        <button type="button" disabled={pending} onClick={() => setEditing((e) => !e)} className={btn.secondary}>
          <Pencil className="size-4" aria-hidden /> {editing ? "Done editing" : "Edit"}
        </button>
        <button type="button" disabled={pending} onClick={() => decide("rejected")} className={btn.dangerGhost}>
          <X className="size-4" aria-hidden /> Decline
        </button>
      </div>
    </Card>
  );
}
