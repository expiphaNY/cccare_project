// =============================================================================
// NoteList.tsx : A SESSION'S NOTES
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Shows a session's notes, one per line. A clinician can edit a note or delete it; deleting asks for confirmation first.
// =============================================================================

"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deleteNoteAction, editNoteAction } from "@/app/actions";
import { DEMO } from "@/lib/demo";
import { btn, cx } from "./ui";
import { RichText } from "./agent/Markdown";

// Same pattern the server uses to keep the "date — clinician:" label when a note is edited.
const NOTE_PREFIX = /^.+? — [^:\n]+: /;

/**
 * A session's notes, one per line. A clinician can edit the wording of a note
 * (its date and author label stay) or delete it. Read-only when `editable` is false.
 */
export function NoteList({
  patientId,
  sessionId,
  notes,
  editable,
  className,
}: {
  patientId: string;
  sessionId: string;
  notes: string;
  editable: boolean;
  className?: string;
}) {
  const lines = notes.split("\n");
  const canChange = editable && !DEMO;
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setEditing(null);
        setConfirming(null);
        setError(null);
      } else setError(res.error);
    });

  return (
    <div className={className}>
      <ul className="space-y-2">
        {lines.map((line, i) => {
          const prefix = line.match(NOTE_PREFIX)?.[0] ?? "";
          const body = line.slice(prefix.length);
          const isEditing = editing === i;
          return (
            <li key={`${i}-${line}`} className="group flex items-start gap-2">
              {isEditing ? (
                <form
                  className="flex min-w-0 flex-1 flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!draft.trim()) return;
                    run(() => editNoteAction(patientId, sessionId, i, line, draft));
                  }}
                >
                  {prefix && <span className="text-[12px] text-ink-3">{prefix.replace(/:\s*$/, "")}</span>}
                  <label className="sr-only" htmlFor={`edit-note-${sessionId}-${i}`}>
                    Edit note
                  </label>
                  <textarea
                    id={`edit-note-${sessionId}-${i}`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    autoFocus
                    className="w-full rounded-xl border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
                  />
                  <div className="flex gap-2">
                    <button type="submit" disabled={pending || !draft.trim()} className={cx(btn.primary, btn.small)}>
                      {pending ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setEditing(null);
                        setError(null);
                      }}
                      className={cx(btn.ghost, btn.small)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="min-w-0 flex-1 text-sm">
                    <RichText text={line} />
                  </p>
                  {canChange &&
                    (confirming === i ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => deleteNoteAction(patientId, sessionId, i, line))}
                          className={cx(btn.danger, btn.small)}
                        >
                          {pending ? "Deleting…" : "Delete note"}
                        </button>
                        <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={cx(btn.ghost, btn.small)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          aria-label="Edit note"
                          title="Edit note"
                          onClick={() => {
                            setEditing(i);
                            setConfirming(null);
                            setDraft(body);
                            setError(null);
                          }}
                          className="flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-3 hover:bg-brand-soft hover:text-brand"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete note"
                          title="Delete note"
                          onClick={() => {
                            setConfirming(i);
                            setEditing(null);
                            setError(null);
                          }}
                          className="flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-3 hover:bg-bad-soft hover:text-bad"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </span>
                    ))}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
