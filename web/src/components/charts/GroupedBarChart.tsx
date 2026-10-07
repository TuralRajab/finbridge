import { useId, useState, type ReactNode } from 'react';
import { useI18n, useLocal } from '../../i18n';
import { compact, money } from '../../lib/format';
import { ticksFor, useWidth } from './useWidth';
import '../../styles/planning.css';

const az = { table: 'Cədvəl görünüşü', chart: 'Qrafik görünüşü', name: 'Ad', select: 'Seçmək üçün klikləyin', forecast: 'proqnoz' };
const TEXT = { az, en: { table: 'Table view', chart: 'Chart view', name: 'Name', select: 'Click to select', forecast: 'forecast' } satisfies typeof az };

export interface BarSeries {
  key: string;
  label: string;
  /** CSS class setting the fill (see planning.css: .pc-s1 … .pc-s4). */
  className: string;
  /** Hatched fill (e.g. a forecast for a partial year); the legend and tooltip say so in words too. */
  hatched?: boolean;
}
export interface BarCategory { key: string; label: string; sublabel?: string }

/**
 * Horizontal grouped bars: one group per category (department, cost center, account), one thin bar per series.
 * Drawn at the container's pixel width so labels stay readable on phones. Hover / focus shows all values of a
 * group; click or Enter selects it. A table view carries the same numbers.
 */
export function GroupedBarChart({ title, categories, series, values, currency, selectedKey, onSelect, footer }: {
  title: string;
  categories: BarCategory[];
  series: BarSeries[];
  /** values[category][series] */
  values: (number | null)[][];
  currency?: string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  footer?: ReactNode;
}) {
  const { locale } = useI18n();
  const L = useLocal(TEXT);
  const uid = useId().replace(/:/g, '');
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = Math.max(300, width);
  const narrow = W < 560;
  const labelW = narrow ? 104 : 200;
  const valueW = narrow ? 46 : 64;
  const barH = narrow ? 7 : 8;
  const gap = 2;
  const groupPad = 14;
  const groupH = series.length * (barH + gap) - gap + groupPad;
  const top = 22;
  const H = top + categories.length * groupH + 6;
  const x0 = labelW + 8;
  const pw = W - x0 - valueW;
  const max = Math.max(1, ...values.flat().map((v) => v ?? 0));
  const { top: axisTop, ticks } = ticksFor(max, narrow ? 3 : 5);
  const x = (v: number) => x0 + (Math.max(0, v) / axisTop) * pw;
  const m = (v: number | null) => (v === null ? '—' : `${money(v, locale)}${currency ? ` ${currency}` : ''}`);
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const maxChars = Math.floor(labelW / 6.6);
  const planIndex = series.length - 1;

  return (
    <div className="chart pc-chart" ref={ref}>
      <div className="mchart-top">
        <div className="legend" aria-label={title}>
          {series.map((s) => (
            <span key={s.key}><i className={`sw ${s.className}${s.hatched ? ' pc-sw-hatch' : ''}`} />{s.label}{s.hatched ? ` (${L.forecast})` : ''}</span>
          ))}
        </div>
        <button type="button" className="link-btn small" onClick={() => setAsTable((v) => !v)}>{asTable ? L.chart : L.table}</button>
      </div>
      {asTable ? (
        <div className="table-scroll">
          <table className="table pc-chart-table">
            <caption className="sr-only">{title}</caption>
            <thead><tr><th>{L.name}</th>{series.map((s) => <th key={s.key} className="r">{s.label}{s.hatched ? ` (${L.forecast})` : ''}</th>)}</tr></thead>
            <tbody>
              {categories.map((c, ci) => (
                <tr key={c.key}>
                  <td>{c.label}{c.sublabel && <div className="muted small">{c.sublabel}</div>}</td>
                  {series.map((s, si) => <td key={s.key} className="r num">{money(values[ci][si], locale)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={title}>
            <title>{title}</title>
            <defs>
              <pattern id={`pc-hatch-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" className="pc-hatch-bg" />
                <line x1="0" y1="0" x2="0" y2="6" className="pc-hatch-line" strokeWidth="3" />
              </pattern>
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={x(v)} x2={x(v)} y1={top - 6} y2={H - 4} className="grid" />
                <text x={x(v)} y={top - 10} textAnchor="middle" className="axis">{compact(v, locale)}</text>
              </g>
            ))}
            {categories.map((c, ci) => {
              const gy = top + ci * groupH + groupPad / 2;
              const selected = selectedKey === c.key;
              const label = `${c.label}: ${series.map((s, si) => `${s.label}${s.hatched ? ` (${L.forecast})` : ''} ${m(values[ci][si])}`).join(', ')}`;
              return (
                <g key={c.key} className={`pc-group${selected ? ' is-selected' : ''}${onSelect ? ' is-clickable' : ''}`} tabIndex={0} role={onSelect ? 'button' : 'img'}
                  aria-label={label} aria-pressed={onSelect ? selected : undefined}
                  onMouseEnter={() => setHover(ci)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(ci)} onBlur={() => setHover(null)}
                  onClick={() => onSelect?.(c.key)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onSelect) { e.preventDefault(); onSelect(c.key); } }}>
                  <rect x={0} y={gy - groupPad / 2} width={W} height={groupH} className={selected ? 'pc-band-selected' : hover === ci ? 'hover-band' : 'pc-band'} />
                  <text x={labelW} y={gy + (groupH - groupPad) / 2 + 4} textAnchor="end" className="pc-label">
                    {cut(c.label, maxChars)}
                  </text>
                  {series.map((s, si) => {
                    const v = values[ci][si];
                    if (v === null) return null;
                    const y = gy + si * (barH + gap);
                    const w = Math.max(v > 0 ? 2 : 0, x(v) - x0);
                    return (
                      <g key={s.key}>
                        <rect x={x0} y={y} width={w} height={barH} rx="2" className={`${s.className}${s.hatched ? ' pc-hatched' : ''}`}
                          style={s.hatched ? { fill: `url(#pc-hatch-${uid})` } : undefined} />
                        {si === planIndex && <text x={x0 + w + 4} y={y + barH} className="pc-value">{compact(v, locale)}</text>}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
          {hover !== null && categories[hover] && (
            <div className="chart-tip" role="status">
              <b>{categories[hover].label}</b>
              {series.map((s, si) => <span key={s.key}>{s.label}{s.hatched ? ` (${L.forecast})` : ''}: {m(values[hover][si])}</span>)}
              {onSelect && <span className="muted">{L.select}</span>}
            </div>
          )}
        </>
      )}
      {footer}
    </div>
  );
}
