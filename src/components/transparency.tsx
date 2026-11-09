import {
  Cpu,
  Database,
  Download,
  Eye,
  FilePlus2,
  KeyRound,
  Link2,
  Link2Off,
  Lock,
  NotebookPen,
  Radio,
  Settings2,
  Stethoscope,
  Trash2,
  Upload,
  User,
  UserRound,
} from "lucide-react";
import type { AuditAction, AuditEvent, Share } from "@/lib/types";
import { fmtDate, fmtDateTime, fmtTime, relTime } from "@/lib/format";
import { shareState } from "@/lib/data";
import { generateSignal } from "@/lib/signal";
import { Badge, cx } from "./ui";
import { RevokeButton } from "./privacy";

const ACTION_META: Record<AuditAction, { label: string; Icon: typeof Eye }> = {
  profile_created: { label: "Profile created", Icon: FilePlus2 },
  profile_viewed: { label: "Viewed profile", Icon: Eye },
  session_viewed: { label: "Viewed a session", Icon: Eye },
  signal_viewed: { label: "Viewed signals", Icon: Eye },
  comparison_viewed: { label: "Compared recordings", Icon: Eye },
  export_pdf: { label: "Downloaded PDF", Icon: Download },
  export_html: { label: "Downloaded HTML", Icon: Download },
  export_fhir: { label: "Exported FHIR bundle", Icon: Download },
  export_csv: { label: "Downloaded raw CSV", Icon: Download },
  share_created: { label: "Created share link", Icon: Link2 },
  share_revoked: { label: "Revoked share link", Icon: Link2Off },
  share_opened: { label: "Opened shared link", Icon: Link2 },
  consent_updated: { label: "Changed consent", Icon: Settings2 },
  data_recorded: { label: "New data recorded", Icon: Upload },
  note_added: { label: "Added clinical note", Icon: NotebookPen },
  profile_deleted: { label: "Profile deleted", Icon: Trash2 },
};

const ROLE_META = {
  clinician: { label: "Clinician", Icon: Stethoscope, tone: "brand" },
  patient: { label: "You", Icon: User, tone: "neutral" },
  recipient: { label: "Share recipient", Icon: Link2, tone: "warn" },
  device: { label: "Sensor", Icon: Radio, tone: "neutral" },
  system: { label: "System", Icon: Cpu, tone: "neutral" },
} as const;

export function AccessLog({
  events,
  audience,
  limit,
}: {
  events: AuditEvent[];
  audience: "clinician" | "patient";
  limit?: number;
}) {
  const shown = limit ? events.slice(0, limit) : events;
  const groups = new Map<string, AuditEvent[]>();
  for (const e of shown) {
    const k = fmtDate(e.at);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return (
    <ol className="space-y-5">
      {[...groups.entries()].map(([day, list]) => (
        <li key={day}>
          <div className="eyebrow mb-2">{day}</div>
          <ol className="relative space-y-0.5 border-l border-line pl-5">
            {list.map((e) => {
              const a = ACTION_META[e.action];
              const role = ROLE_META[e.actor.role];
              const who = e.actor.role === "patient" ? (audience === "patient" ? "You" : e.actor.name) : e.actor.name;
              return (
                <li key={e.id} className="relative py-2">
                  <span
                    className={cx(
                      "absolute -left-[31px] top-2.5 flex size-5 items-center justify-center rounded-full ring-4 ring-white",
                      e.actor.role === "recipient" ? "bg-warn-soft text-warn" : e.actor.role === "clinician" ? "bg-brand-soft text-brand" : "bg-canvas text-ink-2",
                    )}
                  >
                    <a.Icon className="size-3" aria-hidden />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">{a.label}</span>
                    <span className="text-[13px] text-ink-2">by {who}</span>
                    <Badge tone={role.tone} className="!py-0 text-[11px]">
                      {role.label}
                    </Badge>
                    <span className="ml-auto text-[12px] text-ink-3 tabular">{fmtTime(e.at)}</span>
                  </div>
                  <p className="text-[13px] text-ink-2">{e.detail}</p>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
      {limit && events.length > limit && <li className="text-[13px] text-ink-3">+ {events.length - limit} earlier entries</li>}
    </ol>
  );
}

export function SharesTable({ shares, as, patientId }: { shares: Share[]; as: "clinician" | "patient"; patientId: string }) {
  if (!shares.length)
    return <p className="rounded-xl bg-canvas px-4 py-6 text-center text-sm text-ink-2">No share links yet. Nothing has been shared outside the care team.</p>;
  return (
    <ul className="divide-y divide-line">
      {shares.map((s) => {
        const st = shareState(s);
        return (
          <li key={s.token} className="flex flex-wrap items-center gap-3 py-3.5">
            <span
              className={cx(
                "flex size-9 shrink-0 items-center justify-center rounded-full",
                st === "active" ? "bg-brand-soft text-brand" : "bg-canvas text-ink-3",
              )}
            >
              {st === "active" ? <Link2 className="size-4" aria-hidden /> : <Link2Off className="size-4" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{s.recipient}</span>
                <Badge tone={st === "active" ? "good" : "neutral"}>{st === "active" ? "Active" : st === "expired" ? "Expired" : "Revoked"}</Badge>
              </div>
              <p className="text-[13px] text-ink-2">
                {s.purpose} · {s.scope === "full" ? "Entire profile" : `${s.sessionIds?.length} session(s)`}
                {s.includeRaw ? " · incl. raw signals" : ""} · by {s.createdBy.role === "patient" && as === "patient" ? "you" : s.createdBy.name}
              </p>
              <p className="text-[12px] text-ink-3">
                {st === "active" ? `Expires ${relTime(s.expiresAt)}` : st === "expired" ? `Expired ${fmtDate(s.expiresAt)}` : `Revoked ${fmtDate(s.revokedAt!)}`} · Opened{" "}
                {s.accessCount} time{s.accessCount === 1 ? "" : "s"}
                {s.lastAccessedAt ? `, last ${relTime(s.lastAccessedAt)}` : ""}
              </p>
            </div>
            {st === "active" && <RevokeButton as={as} patientId={patientId} token={s.token} recipient={s.recipient} />}
          </li>
        );
      })}
    </ul>
  );
}

/** The data journey, from skin to screen. */
export function DataFlow({ region }: { region: string }) {
  const steps = [
    { Icon: Radio, title: "Sensor on your skin", body: "Measures the tiny electrical signal your muscle makes when it contracts. Nothing else — no audio, video or location." },
    { Icon: Cpu, title: "Microcontroller", body: "Turns it into 3 signals (raw, rectified, envelope) and tags each set with exercise, set number, date & time." },
    { Icon: Lock, title: "Encrypted upload", body: "Sent over TLS 1.3. The device has its own key and can only add data, never read it." },
    { Icon: Database, title: "Secure storage", body: `${region}. Encrypted at rest. Backups are encrypted too.` },
    { Icon: UserRound, title: "You & your clinician", body: "Only people you can see on this page have access. Every view is logged." },
  ];
  return (
    <ol className="grid gap-3 md:grid-cols-5">
      {steps.map((s, i) => (
        <li key={s.title} className="relative rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand">
              <s.Icon className="size-4" aria-hidden />
            </span>
            <span className="eyebrow">Step {i + 1}</span>
          </div>
          <div className="mt-3 text-sm font-semibold">{s.title}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** Mini illustration of the three channels from one synthetic contraction. */
export function SignalExplainer({ plain = true }: { plain?: boolean }) {
  const g = generateSignal({ seed: 7, amplitude: 0.6, reps: 1, fatigue: 0, spectralFatigue: 0 });
  const W = 260;
  const H = 56;
  const step = Math.floor(g.raw.length / W);
  const path = (arr: Float32Array, centered: boolean, max: number) => {
    let d = "";
    for (let px = 0; px < W; px++) {
      let v = 0;
      for (let j = px * step; j < (px + 1) * step; j++) if (Math.abs(arr[j]) > Math.abs(v)) v = arr[j];
      const y = centered ? H / 2 - (v / max) * (H / 2 - 2) : H - 2 - (v / max) * (H - 4);
      d += `${px ? "L" : "M"}${px},${y.toFixed(1)}`;
    }
    return d;
  };
  let mx = 0;
  for (const v of g.raw) mx = Math.max(mx, Math.abs(v));
  let me = 0;
  for (const v of g.envelope) me = Math.max(me, v);
  const items = [
    { name: "Raw", d: path(g.raw, true, mx), c: "#43536b", what: plain ? "The electrical buzz of the muscle, straight from the sensor." : "Bipolar sEMG, 1 kHz." },
    { name: "Rectified", d: path(g.rectified, false, mx), c: "#2a78d6", what: plain ? "Same signal, flipped so everything is positive." : "|raw|, full-wave rectified." },
    { name: "Envelope", d: path(g.envelope, false, me), c: "#0b63ce", what: plain ? "Smoothed into one line: how hard the muscle works. This is what we chart." : "Low-pass of rectified (~3.5 Hz)." },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((it, i) => (
        <figure key={it.name} className="rounded-2xl border border-line bg-white p-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" aria-hidden preserveAspectRatio="none">
            <path d={it.d} fill="none" stroke={it.c} strokeWidth={i === 2 ? 2 : 1} vectorEffect="non-scaling-stroke" />
          </svg>
          <figcaption className="mt-2">
            <span className="text-sm font-semibold">
              {i + 1}. {it.name}
            </span>
            <span className="block text-[13px] text-ink-2">{it.what}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function WhoCanSee({ people }: { people: { who: string; why: string; kind: "care" | "share" | "you" }[] }) {
  return (
    <ul className="space-y-2">
      {people.map((p) => (
        <li key={p.who} className="flex items-center gap-3">
          <span
            className={cx(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              p.kind === "share" ? "bg-warn-soft text-warn" : p.kind === "care" ? "bg-brand-soft text-brand" : "bg-canvas text-ink-2",
            )}
          >
            {p.kind === "share" ? <Link2 className="size-4" aria-hidden /> : p.kind === "care" ? <Stethoscope className="size-4" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{p.who}</span>
            <span className="block text-[12px] text-ink-2">{p.why}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export { fmtDateTime };
