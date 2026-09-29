import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can, type Lang, type MeDto, type Permission } from '@finbridge/shared';
import { api, getToken, setToken, setUnauthorizedHandler } from '../api/client';
import { useI18n } from '../i18n';

interface AuthValue {
  user: MeDto | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<MeDto>;
  logout: () => void;
  refresh: () => Promise<void>;
  can: (p: Permission) => boolean;
  changeLanguage: (l: Lang) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [user, setUser] = useState<MeDto | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const me = await api<MeDto>('GET', '/auth/me');
    setUser(me);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) { setReady(true); return; }
    api<MeDto>('GET', '/auth/me')
      .then((me) => { setUser(me); setLang(me.language); })
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, [logout, setLang]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: MeDto }>('POST', '/auth/login', { email, password });
    setToken(r.token);
    setUser(r.user);
    setLang(r.user.language);
    return r.user;
  }, [setLang]);

  const changeLanguage = useCallback(async (l: Lang) => {
    setLang(l);
    if (getToken()) setUser(await api<MeDto>('PATCH', '/auth/me', { language: l }));
  }, [setLang]);

  const value = useMemo<AuthValue>(() => ({
    user, ready, login, logout, refresh, changeLanguage,
    can: (p) => (user ? can(user.role, p) : false),
  }), [user, ready, login, logout, refresh, changeLanguage]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
