import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MonitorSmartphone } from 'lucide-react';
import { useShortcuts } from '../editor/useShortcuts';
import { SelectedItemPanel } from '../pattern/SelectedItemPanel';
import { restoreWorkingCopy, startAutosave } from '../store/persist';
import { useSession } from '../cloud/session';
import { startLive } from '../cloud/live';
import { startSync, unclaimedProjects } from '../cloud/sync';
import { usePrefs } from '../store/prefs';
import { toast } from '../store/toast';
import { useWorkspace } from '../store/workspace';
import { useDoc } from '../store/doc';
import { AuthDialog } from './AuthDialog';
import { ClaimDialog } from './ClaimDialog';
import { ProjectsDialog } from './ProjectsDialog';
import { NewDesignDialog, Toaster } from './Overlays';
import { Header } from './Header';
import { Inspector } from './Inspector';
import { PatternStage } from './PatternStage';
import { ExportDialog } from './ExportDialog';
import { RenderDialog } from './RenderDialog';
import { Tour } from './Tour';
import { ViewerStage } from './ViewerStage';

const MIN_WIDTH = 900;

export function EditorShell() {
  const { t } = useTranslation();
  const viewMode = usePrefs((s) => s.viewMode);
  const narrow = useNarrow();
  useShortcuts();

  // Restore the working copy, then autosave every change on this device.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void restoreWorkingCopy().then(async (missing) => {
      if (cancelled) return;
      if (missing.length) toast(t('app.missingAssets', { count: missing.length }), 'error');
      useWorkspace.getState().requestFit();
      const stopSave = startAutosave();
      // Cloud: restore the session from the refresh cookie, then sync and live updates (ADR-0009).
      await useSession.getState().init();
      if (cancelled) return stopSave();
      const stopSync = startSync();
      const stopLive = startLive();
      stop = () => {
        stopSave();
        stopSync();
        stopLive();
      };
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [t]);

  // On signing in, offer to save designs made on this device while signed out.
  useEffect(
    () =>
      useSession.subscribe((s, prev) => {
        if (s.status !== 'signedIn' || prev.status === 'signedIn' || prev.status === 'unknown') return;
        void unclaimedProjects().then((ps) => {
          const others = ps.filter((p) => p.id !== useDoc.getState().doc.id);
          if (others.length && !useWorkspace.getState().dialog) useWorkspace.getState().openDialog('claim');
        });
      }),
    [],
  );

  return (
    <div className="flex h-full min-w-[900px] flex-col overflow-hidden">
      <Header />
      <main className="relative flex min-h-0 flex-1">
        {viewMode !== '3d' && <PatternStage />}
        {viewMode !== 'pattern' && <ViewerStage />}
        <Inspector />
        <SelectedItemPanel />
      </main>
      <AuthDialog />
      <ProjectsDialog />
      <ClaimDialog />
      <RenderDialog />
      <ExportDialog />
      <NewDesignDialog />
      <Toaster />
      <Tour />
      {narrow && (
        <div
          role="alert"
          className="fixed inset-x-4 top-4 z-50 flex items-center gap-3 rounded-xl border border-line-strong bg-panel p-3 text-[13px] shadow-panel [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-accent-fg"
        >
          <MonitorSmartphone />
          {t('app.narrow')}
        </div>
      )}
    </div>
  );
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < MIN_WIDTH);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < MIN_WIDTH);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}
