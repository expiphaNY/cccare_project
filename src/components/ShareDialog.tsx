"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Copy, FileJson, FileText, Globe, Link2, Share2, ShieldCheck, X } from "lucide-react";
import { createShareAction } from "@/app/actions";
import { Segmented } from "./Segmented";
import { btn, cx } from "./ui";

export function ShareDialog({
  as,
  patientId,
  patientName,
  sessions,
  triggerLabel = "Share",
  triggerVariant = "primary",
}: {
  as: "clinician" | "patient";
  patientId: string;
  patientName: string;
  sessions: { id: string; label: string }[];
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [recipient, setRecipient] = useState("");
  const [purpose, setPurpose] = useState("");
  const [scope, setScope] = useState<"full" | "sessions">("full");
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState("30");
  const [includeRaw, setIncludeRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [openedAt, setOpenedAt] = useState(0);

  const open = () => {
    setToken(null);
    setError(null);
    setCopied(false);
    setOpenedAt(Date.now());
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();

  const expiryText = new Date(openedAt + Number(days) * 864e5).toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const url = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${token}` : "";

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await createShareAction({
        as,
        patientId,
        recipient,
        purpose,
        days: Number(days),
        scope,
        sessionIds: scope === "sessions" ? picked : undefined,
        includeRaw,
      });
      if (res.ok) setToken(res.token);
      else setError(res.error);
    });

  return (
    <>
      <button type="button" onClick={open} className={btn[triggerVariant]}>
        <Share2 className="size-4" aria-hidden /> {triggerLabel}
      </button>
      <dialog ref={ref} className="sheet" aria-labelledby="share-title" onClick={(e) => e.target === ref.current && close()}>
        <div className="sheet-body overflow-hidden rounded-[22px] bg-white shadow-[var(--shadow-pop)]">
          <div className="flex items-start justify-between gap-3 border-b border-line px-6 pb-4 pt-5">
            <div>
              <h2 id="share-title" className="title text-lg font-semibold">
                {token ? "Link ready" : `Share ${as === "patient" ? "your" : `${patientName}'s`} record`}
              </h2>
              <p className="mt-0.5 text-sm text-ink-2">
                {token
                  ? "Anyone with this link can view what you selected until it expires or you revoke it."
                  : "Every share is time-limited, revocable, and appears in the access log."}
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-canvas">
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {!token ? (
            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
              <label className="block">
                <span className="text-sm font-medium">Who is it for?</span>
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="e.g. Dr. Lee, Lakeview Sports Medicine"
                  className="mt-1.5 block min-h-11 w-full rounded-xl border border-line-strong px-3 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
                />
                <span className="mt-1 block text-[12px] text-ink-3">Shown in the access log so you always know who opened it.</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Reason <span className="font-normal text-ink-3">(optional)</span></span>
                <input
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. Transfer of care, second opinion"
                  className="mt-1.5 block min-h-11 w-full rounded-xl border border-line-strong px-3 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
                />
              </label>

              <fieldset>
                <legend className="text-sm font-medium">What to include</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["full", "Entire profile", "All sessions and full history. Use for transfers to another clinic."],
                      ["sessions", "Selected sessions", "Only the sessions you tick below."],
                    ] as const
                  ).map(([v, t, d]) => (
                    <label
                      key={v}
                      className={cx(
                        "flex cursor-pointer gap-3 rounded-xl border p-3",
                        scope === v ? "border-brand bg-brand-tint" : "border-line hover:border-line-strong",
                      )}
                    >
                      <input type="radio" name="scope" className="mt-1 accent-[#0b63ce]" checked={scope === v} onChange={() => setScope(v)} />
                      <span>
                        <span className="block text-sm font-medium">{t}</span>
                        <span className="block text-[12px] text-ink-2">{d}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {scope === "sessions" && (
                  <div className="fade-in mt-2 max-h-44 overflow-y-auto rounded-xl border border-line p-2">
                    {sessions.map((s) => (
                      <label key={s.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-canvas">
                        <input
                          type="checkbox"
                          className="accent-[#0b63ce]"
                          checked={picked.includes(s.id)}
                          onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))}
                        />
                        {s.label}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
                <input type="checkbox" className="mt-1 accent-[#0b63ce]" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} />
                <span>
                  <span className="block text-sm font-medium">Include raw & rectified signals</span>
                  <span className="block text-[12px] text-ink-2">
                    Off: the recipient sees summaries and the smooth envelope only. Turn on for clinical review of the full waveform.
                  </span>
                </span>
              </label>

              <div>
                <div className="mb-2 text-sm font-medium">Link expires after</div>
                <Segmented
                  label="Expiry"
                  value={days}
                  onChange={setDays}
                  options={[
                    { value: "1", label: "24 hours" },
                    { value: "7", label: "7 days" },
                    { value: "30", label: "30 days" },
                    { value: "90", label: "90 days" },
                  ]}
                />
              </div>

              <div className="flex gap-3 rounded-xl bg-brand-tint p-3 text-[13px] text-ink-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                <p>
                  <b className="text-ink">{recipient || "The recipient"}</b> will be able to view{" "}
                  {scope === "full" ? "the entire profile" : `${picked.length || "the selected"} session${picked.length === 1 ? "" : "s"}`}
                  {includeRaw ? ", including raw signals," : ""} until <b className="text-ink">{expiryText}</b>. Each time the link is opened it is
                  recorded in the access log. You can revoke it at any time.
                </p>
              </div>

              {error && (
                <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-5 px-6 py-5">
              <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas p-1.5 pl-3">
                <Link2 className="size-4 shrink-0 text-ink-3" aria-hidden />
                <input readOnly value={url} className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Share link" onFocus={(e) => e.target.select()} />
                <button
                  type="button"
                  className={cx(btn.primary, btn.small)}
                  onClick={() => {
                    navigator.clipboard?.writeText(url);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium">Or send it as a file</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <FileLink href={`/api/export/html?token=${token}`} icon={<Globe className="size-4" />} title="Interactive HTML" sub="Opens offline in any browser" />
                  <FileLink href={`/api/export/pdf?token=${token}`} icon={<FileText className="size-4" />} title="PDF report" sub="For printing & records" />
                  <FileLink href={`/api/export/fhir?token=${token}`} icon={<FileJson className="size-4" />} title="FHIR R4 bundle" sub="For other clinic systems" />
                </div>
                <p className="mt-2 text-[12px] text-ink-3">Files are a copy: once sent they can’t be revoked. Prefer the link when possible.</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-line bg-canvas/60 px-6 py-4">
            <button type="button" onClick={close} className={btn.secondary}>
              {token ? "Done" : "Cancel"}
            </button>
            {!token && (
              <button type="button" onClick={submit} disabled={pending} className={btn.primary}>
                {pending ? "Creating…" : "Create secure link"}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}

function FileLink({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <a href={href} className="pressable flex items-start gap-2.5 rounded-xl border border-line p-3 hover:border-brand hover:bg-brand-tint">
      <span className="mt-0.5 text-brand" aria-hidden>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[12px] text-ink-2">{sub}</span>
      </span>
    </a>
  );
}
