// Pages that emailed links open: /auth/verify, /auth/magic, /auth/reset (APP_URL on the API).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@gs/ui';
import { ApiError, OfflineError } from '../cloud/api';
import { useSession } from '../cloud/session';
import { toast } from '../store/toast';
import { Logo } from './Logo';

type Kind = 'verify' | 'magic' | 'reset';

export function AuthLanding({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const message = (e: unknown) => {
    if (e instanceof OfflineError) return t('auth.offline');
    if (e instanceof ApiError && (e.code === 'token_invalid' || e.code === 'token_expired')) return t(`auth.errors.${e.code}`);
    if (e instanceof ApiError) {
      const field = (e.body.errors as { message: string }[] | undefined)?.[0];
      return field?.message ?? t('auth.errors.generic', { message: e.message });
    }
    return t('auth.errors.generic', { message: (e as Error).message });
  };

  // Verify and magic links act straight away (once, even under React's double effects in development).
  useEffect(() => {
    if (kind === 'reset' || started.current) return;
    started.current = true;
    const s = useSession.getState();
    const act = kind === 'verify' ? s.init().then(() => s.verifyEmail(token)) : s.verifyMagic(token);
    act.then(
      () => {
        toast(kind === 'verify' ? t('authPage.verified') : t('authPage.signedIn'));
        void navigate({ to: '/', replace: true });
      },
      (e: unknown) => setError(message(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError(t('auth.shortPassword'));
    setBusy(true);
    setError(null);
    try {
      await useSession.getState().reset(token, password);
      toast(t('authPage.resetDone'));
      void navigate({ to: '/', replace: true });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex h-full items-center justify-center bg-bg p-6 text-ink">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-line bg-panel p-6 shadow-panel">
        <Logo />
        {kind === 'reset' ? (
          <form onSubmit={(e) => void submitReset(e)} className="flex flex-col gap-3">
            <h1 className="m-0 text-base font-[650]">{t('authPage.resetTitle')}</h1>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium text-label">
              {t('auth.password')}
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 rounded-lg border border-line-strong bg-field px-3 text-[13px] text-ink outline-none focus:border-accent"
              />
            </label>
            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              {busy ? t('auth.working') : t('authPage.save')}
            </Button>
          </form>
        ) : (
          !error && <p className="m-0 text-[13px] text-muted">{t('authPage.verifying')}</p>
        )}
        {error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        )}
        <button type="button" className="self-start text-[13px] text-accent-fg hover:underline" onClick={() => void navigate({ to: '/' })}>
          {t('authPage.back')}
        </button>
      </div>
    </main>
  );
}
