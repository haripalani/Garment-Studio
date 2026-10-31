import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Modal, Segmented } from '@gs/ui';
import { ApiError, OfflineError } from '../cloud/api';
import { useSession } from '../cloud/session';
import { useWorkspace } from '../store/workspace';

type Mode = 'login' | 'signup' | 'reset';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Log in, sign up, magic link and password reset against the API (ADR-0011). */
export function AuthDialog() {
  const { t } = useTranslation();
  const open = useWorkspace((s) => s.dialog === 'auth');
  const openDialog = useWorkspace((s) => s.openDialog);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const session = useSession();

  function close(o: boolean) {
    if (!o) {
      openDialog(null);
      setNotice(null);
      setFailure(null);
      setErrors({});
      setPassword('');
    }
  }

  /** Server errors become a sentence (or a field error); offline gets its own explanation. */
  function explain(e: unknown) {
    if (e instanceof OfflineError) return setFailure(t('auth.offline'));
    if (e instanceof ApiError) {
      const fieldErrors = (e.body.errors as { path: string; message: string }[] | undefined) ?? [];
      const pw = fieldErrors.find((x) => x.path === 'password');
      if (pw) return setErrors({ password: pw.message });
      const known = ['invalid_credentials', 'email_taken', 'account_locked', 'rate_limited', 'validation_failed'];
      return setFailure(known.includes(e.code) ? t(`auth.errors.${e.code}` as 'auth.errors.generic') : t('auth.errors.generic', { message: e.message }));
    }
    setFailure(t('auth.errors.generic', { message: (e as Error).message }));
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      explain(e);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!EMAIL_RE.test(email)) next.email = t('auth.invalidEmail');
    if (mode === 'signup' && password.length < 10) next.password = t('auth.shortPassword');
    if (mode === 'login' && !password) next.password = t('auth.emptyPassword');
    setErrors(next);
    if (Object.keys(next).length) return;
    void run(async () => {
      if (mode === 'login') {
        await session.signIn(email, password, remember);
        close(false);
      } else if (mode === 'signup') {
        await session.signUp(email, password);
        close(false);
      } else {
        await session.forgot(email);
        setNotice(t('auth.resetSent', { email }));
      }
    });
  }

  function magic() {
    if (!EMAIL_RE.test(email)) return setErrors({ email: t('auth.invalidEmail') });
    setErrors({});
    void run(async () => {
      await session.magicLink(email);
      setNotice(t('auth.magicSent', { email }));
    });
  }

  const title = mode === 'reset' ? t('auth.resetTitle') : t('auth.title');

  return (
    <Modal open={open} onOpenChange={close} title={title} width={400}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        {mode !== 'reset' && (
          <Segmented<'login' | 'signup'>
            label={title}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setNotice(null);
              setFailure(null);
            }}
            className="grid grid-cols-2"
            options={[
              { value: 'login', label: t('auth.login') },
              { value: 'signup', label: t('auth.signup') },
            ]}
          />
        )}

        <Field label={t('auth.email')} error={errors.email}>
          {(a11y) => (
            <input
              {...a11y}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-invalid={!!errors.email}
              className="h-10 w-full rounded-lg border border-line-strong bg-field px-3 text-[13px] text-ink outline-none focus:border-accent aria-invalid:border-danger"
            />
          )}
        </Field>

        {mode !== 'reset' && (
          <Field label={t('auth.password')} error={errors.password}>
            {(a11y) => (
              <div className="relative">
                <input
                  {...a11y}
                  type={show ? 'text' : 'password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!errors.password}
                  className="h-10 w-full rounded-lg border border-line-strong bg-field pr-10 pl-3 text-[13px] text-ink outline-none focus:border-accent aria-invalid:border-danger"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
                  className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-ink [&_svg]:size-4"
                >
                  {show ? <EyeOff /> : <Eye />}
                </button>
              </div>
            )}
          </Field>
        )}

        {mode === 'login' && (
          <div className="flex items-center justify-between text-[13px]">
            <label className="flex items-center gap-2 text-label">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="size-4 accent-(--accent)"
              />
              {t('auth.remember')}
            </label>
            <button type="button" className="text-accent-fg hover:underline" onClick={() => setMode('reset')}>
              {t('auth.forgot')}
            </button>
          </div>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? t('auth.working') : mode === 'login' ? t('auth.login') : mode === 'signup' ? t('auth.signup') : t('auth.resetSend')}
        </Button>

        {failure && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {failure}
          </p>
        )}
        {notice && (
          <p role="status" className="m-0 text-[13px] text-success-fg">
            {notice}
          </p>
        )}

        <div className="flex flex-col items-center gap-2 text-[13px] text-muted">
          {mode === 'reset' ? (
            <button type="button" className="text-accent-fg hover:underline" onClick={() => { setMode('login'); setNotice(null); }}>
              {t('auth.back')}
            </button>
          ) : (
            <>
              <span>
                {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
                <button
                  type="button"
                  className="text-accent-fg hover:underline"
                  onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                >
                  {mode === 'login' ? t('auth.signup') : t('auth.login')}
                </button>
              </span>
              <button type="button" className="text-ink underline-offset-2 hover:underline" disabled={busy} onClick={magic}>
                {t('auth.magic')}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

// The input gets its name from the label only; the error is linked with aria-describedby.
function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: (a11y: { id: string; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-label">
        {label}
      </label>
      {children(error ? { id, 'aria-describedby': errorId } : { id })}
      {error && (
        <span id={errorId} className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
