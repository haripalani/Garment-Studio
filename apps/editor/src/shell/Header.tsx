import { useTranslation } from 'react-i18next';
import {
  Box,
  FileImage,
  FilePlus2,
  FolderOpen,
  Image as ImageIcon,
  LogIn,
  LogOut,
  Moon,
  Printer,
  Redo2,
  Scissors,
  CircleHelp,
  Sun,
  Undo2,
  Video,
  Camera,
  CloudUpload,
  UserRound,
  MailCheck,
} from 'lucide-react';
import { BRAND } from '@gs/core';
import { Button, IconButton, Menu, Segmented, Select, SplitChevron, Tip, cn } from '@gs/ui';
import { useEffect, useState } from 'react';
import { LOCALES } from '../i18n';
import { useDoc } from '../store/doc';
import { onSaveState, type SaveState } from '../store/persist';
import { useSession } from '../cloud/session';
import { push, useSync } from '../cloud/sync';
import { toast } from '../store/toast';
import { usePrefs, type ViewMode } from '../store/prefs';
import { useWorkspace } from '../store/workspace';
import { Logo } from './Logo';
import { takeSnapshot } from '../viewer/studioRef';

function useSaveState(): Exclude<SaveState, 'idle'> | null {
  const [s, setS] = useState<SaveState>('idle');
  useEffect(() => onSaveState(setS), []);
  return s === 'idle' ? null : s;
}

export function Header() {
  const { t } = useTranslation();
  const { theme, setTheme, viewMode, setViewMode, locale, setLocale } = usePrefs();
  const openDialog = useWorkspace((s) => s.openDialog);
  const setTourStep = useWorkspace((s) => s.setTourStep);
  const canUndo = useDoc((s) => s.past.length > 0 || (s.txn?.patches.length ?? 0) > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);
  const docName = useDoc((s) => s.doc.name);
  const garment = useDoc((s) => s.garment);
  const saveState = useSaveState();
  const session = useSession((s) => s.status);
  const sync = useSync((s) => s.state);
  // Local writes first ("Saving…"), then where the design lives: this device or the cloud.
  const status =
    saveState === 'saving' || saveState === 'error'
      ? t(`save.${saveState}`)
      : session === 'signedIn' || sync === 'offline'
        ? t(`sync.${sync}`)
        : saveState
          ? t('save.saved')
          : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel pr-3.5 pl-[18px]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <IconButton label={t('app.exitSoon')} icon={<LogOut className="rotate-180" />} disabled />
        <Logo />
        <Tip label={t('app.version')}>
          <span className="hidden rounded-md border border-line px-1.5 py-px text-[11px] font-semibold text-muted min-[1280px]:inline">
            v{BRAND.version}
          </span>
        </Tip>
        <span className="ml-3 hidden min-w-0 flex-col leading-tight xl:flex">
          <span className="truncate text-[13px] tracking-[0.39px] text-muted uppercase">{docName}</span>
          <small className="truncate text-[9.75px] tracking-[0.39px] text-accent-fg uppercase">
            {garment.name.en} · <span data-testid="save-status">{status ?? garment.cut.en}</span>
          </small>
        </span>
      </div>

      <Segmented<ViewMode>
        label={t('view.label')}
        value={viewMode}
        onChange={setViewMode}
        options={[
          { value: 'pattern', label: t('view.pattern') },
          { value: 'split', label: t('view.split') },
          { value: '3d', label: t('view.3d') },
        ]}
      />

      <div className="flex flex-1 items-center justify-end gap-2">
        <ThemeToggle
          theme={theme}
          onToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          label={t('header.theme')}
        />
        <IconButton label={t('header.tour')} icon={<CircleHelp />} onClick={() => setTourStep(0)} />
        <Select
          label={t('header.language')}
          value={locale}
          onChange={setLocale}
          options={LOCALES.map((l) => ({ value: l.id, label: l.label }))}
          className="h-8 w-[60px] text-muted"
        />
        <div className="flex">
          <IconButton label={t('header.undo')} icon={<Undo2 />} disabled={!canUndo} onClick={undo} />
          <IconButton label={t('header.redo')} icon={<Redo2 />} disabled={!canRedo} onClick={redo} />
        </div>
        <div className="flex">
          <IconButton label={t('header.new')} icon={<FilePlus2 />} onClick={() => openDialog('new')} />
          <IconButton label={t('header.files')} icon={<FolderOpen />} onClick={() => openDialog('projects')} />
          <IconButton
            label={t('header.save')}
            icon={<CloudUpload />}
            onClick={() => (session === 'signedIn' ? void push(useDoc.getState().doc.id) : openDialog('auth'))}
          />
        </div>
        <Tip label={t('header.snapshotTip')}>
          <Button
            icon={<Camera />}
            aria-label={t('header.snapshot')}
            disabled={viewMode === 'pattern'}
            onClick={() => void takeSnapshot()}
          >
            <span className="hidden min-[1200px]:inline">{t('header.snapshot')}</span>
          </Button>
        </Tip>
        <ExportButton />
        {session === 'signedIn' ? (
          <AccountMenu />
        ) : (
          <Button onClick={() => openDialog('auth')} icon={<LogIn />} className="px-3 text-[13px]">
            {t('header.login')}
          </Button>
        )}
      </div>
    </header>
  );
}

function AccountMenu() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const plan = useSession((s) => s.entitlements?.planId);
  if (!user) return null;
  return (
    <Menu
      trigger={
        <Button icon={<UserRound />} aria-label={t('account.menu')} className="max-w-[200px] px-3 text-[13px]">
          <span className="truncate">{user.displayName ?? user.email}</span>
        </Button>
      }
      items={[
        {
          id: 'who',
          icon: <UserRound />,
          label: user.email,
          description: user.emailVerified ? t('account.plan', { plan: plan ?? '…' }) : t('account.unverified'),
          disabled: user.emailVerified,
          onSelect: () => undefined,
        },
        ...(user.emailVerified
          ? []
          : [
              {
                id: 'resend',
                icon: <MailCheck />,
                label: t('account.resend'),
                onSelect: () =>
                  void useSession
                    .getState()
                    .resendVerification()
                    .then(() => toast(t('account.resent'))),
              },
            ]),
        { id: 'out', icon: <LogOut />, label: t('account.signOut'), onSelect: () => void useSession.getState().signOut() },
      ]}
    />
  );
}

function ThemeToggle({
  theme,
  onToggle,
  label,
}: {
  theme: 'dark' | 'light';
  onToggle: () => void;
  label: string;
}) {
  return (
    <Tip label={label}>
      <button
        type="button"
        role="switch"
        aria-checked={theme === 'dark'}
        aria-label={label}
        onClick={onToggle}
        className="relative flex h-[30px] w-[58px] items-center justify-between rounded-[15px] border border-line bg-seg px-[7px] text-icon [&_svg]:z-10 [&_svg]:size-[14px]"
      >
        <span
          className={cn(
            'absolute top-[2px] left-[2px] size-6 rounded-full bg-panel shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform duration-200',
            theme === 'dark' && 'translate-x-[28px]',
          )}
        />
        <Sun className={cn(theme === 'light' && 'text-accent-fg')} />
        <Moon className={cn(theme === 'dark' && 'text-accent-fg')} />
      </button>
    </Tip>
  );
}

function ExportButton() {
  const { t } = useTranslation();
  const openDialog = useWorkspace((s) => s.openDialog);
  return (
    <div className="flex" data-tour="export">
      <Button variant="primary" className="rounded-r-none" onClick={() => openDialog('render')}>
        {t('header.export')}
      </Button>
      <Menu
        trigger={<SplitChevron label={t('header.moreExports')} />}
        items={[
          {
            id: 'render',
            icon: <ImageIcon />,
            label: t('export.render'),
            description: t('export.renderDesc'),
            onSelect: () => openDialog('render'),
          },
          {
            id: 'print',
            icon: <Printer />,
            label: t('export.print'),
            description: t('export.printDesc'),
            onSelect: () => openDialog('print'),
          },
          {
            id: 'panels',
            icon: <Scissors />,
            label: t('export.panels'),
            description: t('export.panelsDesc'),
            onSelect: () => openDialog('panels'),
          },
          {
            id: 'spec',
            icon: <FileImage />,
            label: t('export.spec'),
            description: t('export.specDesc'),
            onSelect: () => openDialog('spec'),
          },
          {
            id: 'video',
            icon: <Video />,
            label: t('export.video'),
            description: t('export.videoDesc'),
            onSelect: () => openDialog('video'),
          },
          {
            id: 'box',
            icon: <Box />,
            label: t('header.snapshot'),
            description: t('header.snapshotTip'),
            onSelect: () => void takeSnapshot(),
          },
        ]}
      />
    </div>
  );
}
