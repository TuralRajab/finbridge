import { useEffect, useRef, useState, type RefObject } from 'react';

/** Measures the rendered width of a container so SVG charts draw at 1:1 pixels (readable text on phones). */
export function useWidth<T extends HTMLElement>(fallback = 720): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => { const w = Math.round(el.getBoundingClientRect().width); if (w > 0) setWidth(w); };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** 0-based axis ticks covering `max` with ~`count` nice steps. */
export function ticksFor(max: number, count = 4): { top: number; ticks: number[] } {
  const step = niceStep(Math.max(1, max) / count);
  const top = Math.max(step, Math.ceil(Math.max(1, max) / step) * step);
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}
