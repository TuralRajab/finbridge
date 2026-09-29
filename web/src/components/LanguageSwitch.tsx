import { LANGS } from '@finbridge/shared';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';

export function LanguageSwitch({ dark }: { dark?: boolean }) {
  const { lang, setLang } = useI18n();
  const { user, changeLanguage } = useAuth();
  return (
    <div className={`lang-switch${dark ? ' lang-dark' : ''}`} role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l} type="button" aria-pressed={l === lang} className={l === lang ? 'is-active' : ''}
          onClick={() => (user ? void changeLanguage(l) : setLang(l))}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
