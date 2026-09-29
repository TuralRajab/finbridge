import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '@finbridge/shared';
import { az, type Dict } from './az';
import { en } from './en';

const DICTS: Record<Lang, Dict> = { az, en };
const STORAGE_KEY = 'finbridge.lang';

type Leaves<T> = T extends string ? never : { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}` }[keyof T & string];
export type TKey = Leaves<Dict>;
export type TFunction = (key: TKey, params?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFunction;
  locale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'az' || v === 'en') return v;
  } catch { /* storage unavailable */ }
  return 'az';
}

function lookup(dict: Dict, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part];
  return typeof cur === 'string' ? cur : undefined;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);
  const value = useMemo<I18nValue>(() => {
    const dict = DICTS[lang];
    const t: TFunction = (key, params) => {
      let s = lookup(dict, key) ?? lookup(az, key) ?? key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    return { lang, setLang, t, locale: lang === 'az' ? 'az-Latn-AZ' : 'en-GB' };
  }, [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useI18n must be used inside I18nProvider');
  return v;
}
