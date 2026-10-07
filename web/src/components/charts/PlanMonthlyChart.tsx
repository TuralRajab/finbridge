import { useState } from 'react';
import { MONTH_SHORT } from '@finbridge/shared';
import { useI18n, useLocal } from '../../i18n';
import { compact, money } from '../../lib/format';
import { ticksFor, useWidth } from './useWidth';
import '../../styles/planning.css';

const az = { table: 'Cədvəl görünüşü', chart: 'Qrafik görünüşü', month: 'Ay', total: 'Cəmi', noActual: 'fakt yoxdur' };
const TEXT = { az, en: { table: 'Table view', chart: 'Chart view', month: 'Month', total: 'Total', noActual: 'no actual' } satisfies typeof az };

export interface MonthlyLine {
  key: string;
  label: string;
  /** CSS class for stroke / marker colour (planning.css). */
  className: string;
  values: (number | null)[];
  dashed?: boolean;
}

/**
 * Monthly comparison on one axis: the plan as columns, prior years' actuals as solid lines with markers and
 * last year's budget as a dashed line. Months without actuals leave a gap. Table view included.
 */
export function PlanMonthlyChart({ title, plan, planLabel, lines, currency }: {
  title: string; plan: number[]; planLabel: string; lines: MonthlyLine[]; currency?: string;
}) {
  const { lang, locale } = useI18n();
  const L = useLocal(TEXT);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = Math.max(300, width);
  const H = W < 560 ? 220 : 260;
  const Lm = 48, B = 24, T = 10, R = 8;
  const pw = W - Lm - R, ph = H - B - T;
  const slot = pw / 12;
  const bw = Math.min(22, slot * 0.45);
  const max = Math.max(1, ...plan, ...lines.flatMap((l) => l.values.map((v) => v ?? 0)));
  const { top, ticks } = ticksFor(max, 4);
  const y = (v: number) => T + ph - (Math.max(0, v) / top) * ph;
  const cx = (i: number) => Lm + slot * i + slot / 2;
  const months = MONTH_SHORT[lang];
  const m = (v: number | null) => (v === null ? '—' : `${money(v, locale)}${currency ? ` ${currency}` : ''}`);
  const total = (vs: (number | null)[]) => vs.reduce<number>((s, v) => s + (v ?? 0), 0);

  const path = (vs: (number | null)[]) => {
    let d = '';
    let pen = false;
    vs.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  return (
    <div className="chart pc-chart" ref={ref}>
      <div className="mchart-top">
        <div className="legend">
          <span><i className="sw pc-s4" />{planLabel}</span>
          {lines.map((l) => <span key={l.key}><i className={`pc-sw-line ${l.className}${l.dashed ? ' is-dashed' : ''}`} />{l.label}</span>)}
        </div>
        <button type="button" className="link-btn small" onClick={() => setAsTable((v) => !v)}>{asTable ? L.chart : L.table}</button>
      </div>
      {asTable ? (
        <div className="table-scroll">
          <table className="table pc-chart-table">
            <caption className="sr-only">{title}</caption>
            <thead><tr><th>{L.month}</th>{lines.map((l) => <th key={l.key} className="r">{l.label}</th>)}<th className="r">{planLabel}</th></tr></thead>
            <tbody>
              {months.map((mo, i) => (
                <tr key={mo}>
                  <td>{mo}</td>
                  {lines.map((l) => <td key={l.key} className="r num">{l.values[i] === null ? <span className="muted">—</span> : money(l.values[i], locale)}</td>)}
                  <td className="r num">{money(plan[i], locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td><b>{L.total}</b></td>
              {lines.map((l) => <td key={l.key} className="r num"><b>{money(total(l.values), locale)}</b></td>)}
              <td className="r num"><b>{money(total(plan), locale)}</b></td>
            </tr></tfoot>
          </table>
        </div>
      ) : (
        <>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
            <title>{title}</title>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={Lm} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
                <text x={Lm - 6} y={y(v) + 4} textAnchor="end" className="axis">{compact(v, locale)}</text>
              </g>
            ))}
            {hover !== null && <rect x={Lm + slot * hover + 1} y={T} width={slot - 2} height={ph} className="hover-band" />}
            {plan.map((v, i) => (
              <rect key={i} x={cx(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0, T + ph - y(v))} rx="3" className="pc-s4" />
            ))}
            {lines.map((l) => (
              <g key={l.key} className={l.className}>
                <path d={path(l.values)} className={`pc-line${l.dashed ? ' is-dashed' : ''}`} />
                {!l.dashed && l.values.map((v, i) => (v === null ? null : <circle key={i} cx={cx(i)} cy={y(v)} r="4" className="pc-dot" />))}
              </g>
            ))}
            {months.map((mo, i) => (
              <g key={mo} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={Lm + slot * i} y={T} width={slot} height={ph + B} fill="transparent" />
                <text x={cx(i)} y={H - 7} textAnchor="middle" className="axis">{mo}</text>
              </g>
            ))}
          </svg>
          {hover !== null && (
            <div className="chart-tip" role="status">
              <b>{months[hover]}</b>
              <span>{planLabel}: {m(plan[hover])}</span>
              {lines.map((l) => <span key={l.key}>{l.label}: {l.values[hover] === null ? L.noActual : m(l.values[hover])}</span>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
