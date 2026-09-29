import { useState } from 'react';
import { MONTH_SHORT, type MonthlyPoint } from '@finbridge/shared';
import { useI18n } from '../i18n';
import { compact, money } from '../lib/format';

/** Grouped columns: budget (light) vs actual (dark, red cap where over budget). */
export function MonthlyChart({ data }: { data: MonthlyPoint[] }) {
  const { lang, locale, t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.max(d.budget, d.actual ?? 0)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const W = 720, H = 240, L = 48, B = 26, T = 10;
  const pw = W - L - 8, ph = H - B - T;
  const slot = pw / 12;
  const bw = Math.min(14, slot / 3);
  const y = (v: number) => T + ph - (v / top) * ph;

  return (
    <div className="chart">
      <div className="legend">
        <span><i className="sw sw-budget" />{t('pva.budgetYtd')}</span>
        <span><i className="sw sw-actual" />{t('pva.actualYtd')}</span>
        <span><i className="sw sw-over" />{t('dashboard.over')}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('dashboard.monthlyTitle')}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - 8} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{compact(v, locale)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = L + slot * i + slot / 2;
          const over = d.actual !== null && d.actual > d.budget;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + slot * i} y={T} width={slot} height={ph} fill="transparent" />
              {hover === i && <rect x={L + slot * i + 2} y={T} width={slot - 4} height={ph} className="hover-band" />}
              <rect x={cx - bw - 1} y={y(d.budget)} width={bw} height={Math.max(0, y(0) - y(d.budget))} rx="3" className="bar-budget" />
              {d.actual !== null && (
                <>
                  <rect x={cx + 1} y={y(Math.min(d.actual, d.budget))} width={bw} height={Math.max(0, y(0) - y(Math.min(d.actual, d.budget)))} rx="3" className="bar-actual" />
                  {over && <rect x={cx + 1} y={y(d.actual)} width={bw} height={Math.max(0, y(d.budget) - y(d.actual) - 1.5)} rx="3" className="bar-over" />}
                </>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className="axis">{MONTH_SHORT[lang][i]}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip">
          <b>{MONTH_SHORT[lang][hover]}</b>
          <span>{t('pva.budgetYtd')}: {money(data[hover].budget, locale)}</span>
          <span>{t('pva.actualYtd')}: {money(data[hover].actual, locale)}</span>
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
