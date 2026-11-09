import Link from "next/link";
import type React from "react";
import type { ComponentProps, ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus, Sparkles, TrendingDown } from "lucide-react";
import type { Status } from "@/lib/analytics";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  as: As = "section",
  ...rest
}: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">) {
  return (
    <As
      className={cx("rounded-card border border-line bg-white shadow-[var(--shadow-card)]", className)}
      {...rest}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="title text-[17px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

const btnBase =
  "pressable inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-medium min-h-10 px-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";

export const btn = {
  primary: cx(btnBase, "bg-brand text-white hover:bg-brand-strong shadow-sm"),
  secondary: cx(btnBase, "bg-white text-brand border border-line-strong hover:bg-brand-tint"),
  ghost: cx(btnBase, "text-brand hover:bg-brand-soft"),
  danger: cx(btnBase, "bg-bad text-white hover:bg-[#981d1d]"),
  dangerGhost: cx(btnBase, "text-bad border border-[#efc4c2] bg-white hover:bg-bad-soft"),
  small: "min-h-8 px-3 text-[13px]",
};

export function ButtonLink({
  href,
  variant = "secondary",
  className,
  children,
  ...rest
}: { href: string; variant?: keyof Omit<typeof btn, "small">; className?: string; children: ReactNode } & Omit<
  ComponentProps<typeof Link>,
  "href" | "className" | "children"
>) {
  return (
    <Link href={href} className={cx(btn[variant], className)} {...rest}>
      {children}
    </Link>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "good" | "warn" | "bad";
  className?: string;
  title?: string;
}) {
  const tones = {
    neutral: "bg-canvas text-ink-2 border-line",
    brand: "bg-brand-soft text-brand-strong border-transparent",
    good: "bg-good-soft text-good border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
    bad: "bg-bad-soft text-bad border-transparent",
  };
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Status always pairs colour with an icon and a word — never colour alone. */
export function StatusBadge({ status, audience = "clinician" }: { status: Status; audience?: "clinician" | "patient" }) {
  const map = {
    improving: { tone: "good", Icon: ArrowUpRight, c: "Improving", p: "Getting stronger" },
    steady: { tone: "brand", Icon: Minus, c: "Plateau", p: "Holding steady" },
    declining: { tone: "warn", Icon: TrendingDown, c: "Declining", p: "Dipped recently" },
    new: { tone: "neutral", Icon: Sparkles, c: "New", p: "Just getting started" },
  } as const;
  const m = map[status];
  return (
    <Badge tone={m.tone}>
      <m.Icon className="size-3.5" aria-hidden />
      {audience === "patient" ? m.p : m.c}
    </Badge>
  );
}

export function Delta({ value, digits = 0, suffix = "%" }: { value: number; digits?: number; suffix?: string }) {
  const up = value > 0.5;
  const down = value < -0.5;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span
      className={cx(
        "tabular inline-flex items-center gap-0.5 font-medium",
        up ? "text-good" : down ? "text-bad" : "text-ink-2",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {value > 0 ? "+" : ""}
      {value.toFixed(digits)}
      {suffix}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  help,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  help?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-ink-2" title={help}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="display tabular text-[26px] font-semibold text-ink">{value}</span>
        {unit && <span className="text-sm text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[13px]">{sub}</div>}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="no-print">
      <ol className="flex flex-wrap items-center gap-1 text-[13px] text-ink-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-ink-3" aria-hidden />}
            {it.href ? (
              <Link href={it.href} className="rounded px-1 py-0.5 hover:bg-brand-soft hover:text-brand">
                {it.label}
              </Link>
            ) : (
              <span className="px-1 py-0.5 font-medium text-ink" aria-current="page">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Macro → micro indicator. Shows the user where they are in the data
 * hierarchy and that there is more detail below.
 */
export function DepthLadder({ level }: { level: 0 | 1 | 2 | 3 }) {
  const steps = ["Profile", "Session", "Set", "Raw signal"];
  return (
    <div className="no-print flex items-center gap-1.5" aria-label={`Detail level: ${steps[level]}`}>
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <span
            className={cx(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              i === level ? "bg-brand text-white" : i < level ? "bg-brand-soft text-brand-strong" : "bg-canvas text-ink-3",
            )}
          >
            {s}
          </span>
          {i < steps.length - 1 && <span className="h-px w-3 bg-line-strong" aria-hidden />}
        </div>
      ))}
    </div>
  );
}

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cx("mx-auto w-full max-w-7xl flex-1 px-4 pb-16 sm:px-6 lg:px-8", className)}>{children}</main>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-white px-6 py-14 text-center">
      <p className="title text-lg font-semibold">{title}</p>
      <p className="mt-1 max-w-md text-sm text-ink-2">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Avatar({ text, size = "md" }: { text: string; size?: "sm" | "md" | "lg" }) {
  const s = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg" }[size];
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#dcEAfd] to-[#c3dafa] font-semibold text-brand-strong",
        s,
      )}
    >
      {text}
    </span>
  );
}

export function KeyValue({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      {items.map((it) => (
        <div key={it.k} className="contents">
          <dt className="text-ink-2">{it.k}</dt>
          <dd className="min-w-0 text-ink">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
