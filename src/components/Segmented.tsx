"use client";

import { cx } from "./ui";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-full bg-[#edf1f7] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              "pressable cursor-pointer whitespace-nowrap rounded-full font-medium",
              size === "sm" ? "min-h-7 px-2.5 text-[12px]" : "min-h-8 px-3.5 text-[13px]",
              active ? "bg-white text-ink shadow-[0_1px_3px_rgb(15_30_51/0.12)]" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
