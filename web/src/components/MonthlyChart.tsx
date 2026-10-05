import { useState } from 'react';
import { MONTH_SHORT, type MonthlyPoint } from '@finbridge/shared';
import { useI18n, useLocal } from '../i18n';
import { compact, money } from '../lib/format';
import '../styles/reports.css';

const az = { budget: 'Büdcə', actual: 'Fakt', committed: 'Öhdəlik', over: 'Büdcədən artıq', table: 'Cədvəl görünüşü', chart: 'Qrafik görünüşü', aria: 'Aylar üzrə büdcə, fakt və öhdəlik', month: 'Ay', total: 'Cəmi' };
const TEXT = {
  az,
  en: { budget: 'Budget', actual: 'Actual', committed: 'Committed', over: 'Over budget', table: 'Table view', chart: 'Chart view', aria: 'Monthly budget, actual and committed', month: 'Month', total: 'Total' } satisfies typeof az,
};

/**
 * Monthly columns: budget (light) next to a stacked bar of actual (solid) + open commitments
 * (hatched). Actual above the month's budget is flagged with a red cap and ▲ in the tooltip.
 */
export function MonthlyChart({ data, currency }: { data: MonthlyPoint[]; currency?: string }) {
  const { lang, locale } = useI18n();
  const L = useLocal(TEXT);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => Math.max(d.budget, (d.actual ?? 0) + d.committed)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const W = 720, H = 250, Lm = 52, B = 26, T = 10;
  const pw = W - Lm - 8, ph = H - B - T;
  const slot = pw / 12;
  const bw = Math.min(18, slot / 3);
  const y = (v: number) => T + ph - (v / top) * ph;
  const h = (v: number) => Math.max(0, (v / top) * ph);
  const m = (v: number | null) => (v === null ? '—' : `${money(v, locale)}${currency ? ` ${currency}` : ''}`);
  const sum = (f: (d: MonthlyPoint) => number) => data.reduce((s, d) => s + f(d), 0);

  return (
    <div className="chart mchart">
      <div className="mchart-top">
        <div className="legend">
          <span><i className="sw sw-budget" />{L.budget}</span>
          <span><i className="sw sw-actual" />{L.actual}</span>
          <span><i className="sw sw-committed" />{L.committed}</span>
          <span><i className="sw sw-over" />{L.over}</span>
        </div>
        <button type="button" className="link-btn small" onClick={() => setAsTable((v) => !v)}>{asTable ? L.chart : L.table}</button>
      </div>
      {asTable ? (
        <div className="table-scroll">
          <table className="table mchart-table">
            <thead><tr><th>{L.month}</th><th className="r">{L.budget}</th><th className="r">{L.actual}</th><th className="r">{L.committed}</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month}>
                  <td>{MONTH_SHORT[lang][d.month - 1]}</td>
                  <td className="r num">{money(d.budget, locale)}</td>
                  <td className="r num">{money(d.actual, locale)}</td>
                  <td className="r num">{money(d.committed, locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td><b>{L.total}</b></td>
              <td className="r num"><b>{money(sum((d) => d.budget), locale)}</b></td>
              <td className="r num"><b>{money(sum((d) => d.actual ?? 0), locale)}</b></td>
              <td className="r num"><b>{money(sum((d) => d.committed), locale)}</b></td>
            </tr></tfoot>
          </table>
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={L.aria}>
            <defs>
              <pattern id="mchart-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" className="hatch-bg" />
                <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" strokeWidth="3" />
              </pattern>
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={Lm} x2={W - 8} y1={y(v)} y2={y(v)} className="grid" />
                <text x={Lm - 8} y={y(v) + 4} textAnchor="end" className="axis">{compact(v, locale)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = Lm + slot * i + slot / 2;
              const actual = d.actual ?? 0;
              const within = Math.min(actual, d.budget);
              const over = Math.max(0, actual - d.budget);
              const gap = actual > 0 && d.committed > 0 ? 2 : 0;
              const label = `${MONTH_SHORT[lang][i]}: ${L.budget} ${m(d.budget)}, ${L.actual} ${m(d.actual)}, ${L.committed} ${m(d.committed)}`;
              return (
                <g key={d.month} tabIndex={0} role="img" aria-label={label} className="mchart-month"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                  <rect x={Lm + slot * i} y={T} width={slot} height={ph} fill="transparent" />
                  {hover === i && <rect x={Lm + slot * i + 2} y={T} width={slot - 4} height={ph} className="hover-band" />}
                  <rect x={cx - bw - 1} y={y(d.budget)} width={bw} height={h(d.budget)} rx="3" className="bar-budget" />
                  {within > 0 && <rect x={cx + 1} y={y(within)} width={bw} height={h(within)} rx="3" className="bar-actual" />}
                  {over > 0 && <rect x={cx + 1} y={y(actual)} width={bw} height={Math.max(0, h(over) - 2)} rx="3" className="bar-over" />}
                  {d.committed > 0 && (
                    <rect x={cx + 1} y={y(actual + d.committed)} width={bw} height={Math.max(0, h(d.committed) - gap)} rx="3" fill="url(#mchart-hatch)" className="bar-committed" />
                  )}
                  <text x={cx} y={H - 8} textAnchor="middle" className="axis">{MONTH_SHORT[lang][i]}</text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chart-tip" role="status">
              <b>{MONTH_SHORT[lang][hover]}</b>
              <span>{L.budget}: {m(data[hover].budget)}</span>
              <span>{L.actual}: {m(data[hover].actual)}{(data[hover].actual ?? 0) > data[hover].budget ? ' ▲' : ''}</span>
              <span>{L.committed}: {m(data[hover].committed)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
