"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, FileJson, FileText, Globe, Trash2, X } from "lucide-react";
import { deletePatientAction, revokeShareAction, updateConsentAction } from "@/app/actions";
import { DEMO, DEMO_MSG } from "@/lib/demo";
import { btn, cx } from "./ui";

/* ---------------- Revoke ---------------- */

export function RevokeButton({ as, patientId, token, recipient }: { as: "clinician" | "patient"; patientId: string; token: string; recipient: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending || DEMO}
      title={DEMO ? DEMO_MSG : undefined}
      onClick={() => start(() => revokeShareAction(as, patientId, token))}
      className={cx(btn.dangerGhost, btn.small, DEMO && "cursor-not-allowed opacity-50")}
      aria-label={`Revoke link for ${recipient}`}
    >
      {pending ? "Revoking…" : "Revoke"}
    </button>
  );
}

/* ---------------- Consent ---------------- */

const CONSENT_ITEMS = [
  {
    key: "careTeamAccess",
    title: "Let my whole care team see my data",
    body: "Off: only your assigned clinician can view. On: other clinicians at the same clinic can view when covering your care.",
  },
  {
    key: "patientSharing",
    title: "Allow me to create share links",
    body: "Lets you send your record to another doctor, a family member, or yourself.",
  },
  {
    key: "researchDeidentified",
    title: "Use my data for research, without my name",
    body: "Your name, birth date and record number are removed first. Off by default. Turning it off later removes your data from future studies.",
  },
] as const;

export function ConsentToggles({
  as,
  patientId,
  consent,
}: {
  as: "clinician" | "patient";
  patientId: string;
  consent: { careTeamAccess: boolean; patientSharing: boolean; researchDeidentified: boolean; updatedAt: string };
}) {
  const [state, setState] = useState(consent);
  const [pending, start] = useTransition();
  return (
    <div className="divide-y divide-line">
      <div className="flex items-start gap-4 py-4">
        <div className="flex-1">
          <div className="text-sm font-medium">Use my data for my own care</div>
          <p className="mt-0.5 text-[13px] text-ink-2">Required — this is why the data is collected. To stop, delete the profile below.</p>
        </div>
        <span className="mt-0.5 rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-ink-2">Always on</span>
      </div>
      {CONSENT_ITEMS.map((it) => {
        const on = state[it.key];
        return (
          <div key={it.key} className="flex items-start gap-4 py-4">
            <div className="flex-1">
              <div className="text-sm font-medium" id={`c-${it.key}`}>
                {it.title}
              </div>
              <p className="mt-0.5 text-[13px] text-ink-2">{it.body}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby={`c-${it.key}`}
              disabled={pending || DEMO}
              title={DEMO ? DEMO_MSG : undefined}
              onClick={() => {
                const next = !on;
                setState((s) => ({ ...s, [it.key]: next }));
                start(() => updateConsentAction(as, patientId, { [it.key]: next }));
              }}
              className={cx(
                "relative mt-0.5 inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200",
                on ? "bg-brand" : "bg-[#d5dce6]",
                DEMO && "cursor-not-allowed opacity-60",
              )}
            >
              <span
                className={cx(
                  "inline-block size-[27px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.18)] transition-transform duration-300 [transition-timing-function:cubic-bezier(0.3,1.3,0.5,1)]",
                  on ? "translate-x-[22px]" : "translate-x-[2px]",
                )}
              />
            </button>
          </div>
        );
      })}
      <p className="pt-3 text-[12px] text-ink-3">
        Last changed {new Date(state.updatedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}. Every change is
        recorded in the access log.
        {DEMO && <b className="font-medium text-ink-2"> Switches are locked in the read-only demo.</b>}
      </p>
    </div>
  );
}

/* ---------------- Export ---------------- */

export function ExportLinks({ query, compact }: { query: string; compact?: boolean }) {
  const items = [
    { href: `/api/export/pdf?${query}`, icon: FileText, title: "PDF report", sub: "Summary, charts & full history" },
    { href: `/api/export/html?${query}`, icon: Globe, title: "Interactive HTML", sub: "Self-contained, works offline" },
    { href: `/api/export/fhir?${query}`, icon: FileJson, title: "FHIR R4 bundle (JSON)", sub: "Standard format other clinics can import" },
  ];
  return (
    <div className={cx("grid gap-2", compact ? "" : "sm:grid-cols-3")}>
      {items.map((it) =>
        DEMO ? (
          // Exports are generated by the server, which the static demo doesn't have.
          <div key={it.href} aria-disabled="true" title="Exports need the full app; the demo has no server" className="flex items-start gap-3 rounded-xl border border-line p-3 opacity-50">
            <it.icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{it.title}</span>
              <span className="block text-[12px] text-ink-2">Not available in the demo</span>
            </span>
          </div>
        ) : (
          <a key={it.href} href={it.href} className="pressable flex items-start gap-3 rounded-xl border border-line p-3 hover:border-brand hover:bg-brand-tint">
            <it.icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{it.title}</span>
              <span className="block text-[12px] text-ink-2">{it.sub}</span>
            </span>
            <Download className="ml-auto mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          </a>
        ),
      )}
    </div>
  );
}

/* ---------------- Delete ---------------- */

export function DeleteProfile({
  as,
  patientId,
  patientName,
  counts,
  exportQuery,
}: {
  as: "clinician" | "patient";
  patientId: string;
  patientName: string;
  counts: { sessions: number; recordings: number; shares: number };
  exportQuery: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const matches = typed.trim().toLowerCase() === patientName.toLowerCase();
  const you = as === "patient";

  return (
    <>
      <button type="button" className={btn.dangerGhost} onClick={() => ref.current?.showModal()}>
        <Trash2 className="size-4" aria-hidden /> {you ? "Delete my profile" : "Delete profile"}
      </button>
      <dialog ref={ref} className="sheet" aria-labelledby="del-title" >
        <div className="sheet-body overflow-hidden rounded-[22px] bg-white shadow-[var(--shadow-pop)]">
          {(
            <>
              <div className="flex items-start justify-between gap-3 px-6 pb-2 pt-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-bad-soft text-bad">
                    <AlertTriangle className="size-5" aria-hidden />
                  </span>
                  <h2 id="del-title" className="title text-lg font-semibold">
                    Delete {you ? "your" : `${patientName}'s`} profile?
                  </h2>
                </div>
                <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-canvas">
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div className="space-y-4 px-6 py-3 text-sm">
                <p className="text-ink-2">This permanently removes, and cannot be undone:</p>
                <ul className="grid grid-cols-3 gap-2 text-center">
                  {[
                    [counts.sessions, "sessions"],
                    [counts.recordings, "recorded sets & signals"],
                    [counts.shares, "share links (stop working)"],
                  ].map(([n, l]) => (
                    <li key={String(l)} className="rounded-xl bg-canvas px-2 py-3">
                      <div className="display tabular text-xl font-semibold">{n}</div>
                      <div className="text-[12px] text-ink-2">{l}</div>
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-ink-2">
                  Also removed: the profile, consent settings and the access log. We keep only a <b>deletion receipt</b> (date, who asked, and how
                  many records were removed) with no name or health data — so deletion can be proven later.
                </p>
                <div className="rounded-xl border border-line p-3">
                  <div className="mb-2 text-[13px] font-medium">Keep a copy first? (recommended)</div>
                  <ExportLinks query={exportQuery} compact />
                </div>
                <label className="block">
                  <span className="text-[13px]">
                    Type <b>{patientName}</b> to confirm
                  </span>
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    className="mt-1.5 block min-h-11 w-full rounded-xl border border-line-strong px-3 text-[15px] outline-none focus:border-bad focus:ring-4 focus:ring-bad/15"
                  />
                </label>
                {error && (
                  <p role="alert" className="text-sm text-bad">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-line bg-canvas/60 px-6 py-4">
                <button type="button" className={btn.secondary} onClick={() => ref.current?.close()}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={btn.danger}
                  disabled={!matches || pending}
                  onClick={() =>
                    start(async () => {
                      const r = await deletePatientAction(as, patientId, typed);
                      if (r.ok) router.replace(`/deleted?r=${r.receiptId}&from=${as}`);
                      else setError(r.error);
                    })
                  }
                >
                  {pending ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
