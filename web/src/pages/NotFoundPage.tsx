import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="empty big">
      <h1>404</h1>
      <p>{t('notFound.title')}</p>
      <Link className="btn btn-primary" to="/">{t('notFound.home')}</Link>
    </div>
  );
}
