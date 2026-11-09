/** Tiny inline trend. Server-renderable SVG; decorative (value is stated next to it). */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = "#0b63ce",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 3;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${d}L${x(values.length - 1)},${height}L${x(0)},${height}Z`;
  const id = `sg${Math.round(values[0] * 1e4)}${values.length}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.16" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" fill={color} />
    </svg>
  );
}

/** Per-rep peaks as thin bars — shows fatigue within a set at a glance. */
export function RepBars({ values, height = 44 }: { values: number[]; height?: number }) {
  if (!values.length) return null;
  const max = Math.max(...values);
  return (
    <div className="flex items-end gap-1" style={{ height }} aria-label={`Rep peaks: ${values.map((v) => v.toFixed(2)).join(", ")} mV`} role="img">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full max-w-4 rounded-t-[4px] bg-brand/80"
            style={{ height: Math.max(3, (v / max) * (height - 14)) }}
            title={`Rep ${i + 1}: ${v.toFixed(3)} mV`}
          />
          <span className="text-[10px] leading-none text-ink-3 tabular">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}
