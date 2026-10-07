import '../../styles/planning.css';

/**
 * Tiny 12-month comparison for a grid row: reference months (e.g. last year's actual) as light columns and the
 * plan as a line. Decorative summary only — the exact numbers sit in the neighbouring cells; `label` describes it.
 */
export function Sparkline({ reference, plan, label, width = 76, height = 20 }: {
  reference: number[]; plan: number[]; label: string; width?: number; height?: number;
}) {
  const max = Math.max(1, ...reference, ...plan);
  const slot = width / 12;
  const y = (v: number) => height - 1 - (Math.max(0, v) / max) * (height - 3);
  const line = plan.map((v, i) => `${i ? 'L' : 'M'}${(slot * i + slot / 2).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="pc-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <title>{label}</title>
      {reference.map((v, i) => (
        <rect key={i} x={slot * i + 0.5} y={y(v)} width={Math.max(1, slot - 1.5)} height={Math.max(0, height - 1 - y(v))} className="pc-spark-ref" />
      ))}
      <path d={line} className="pc-spark-plan" />
    </svg>
  );
}
