import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MonitorSmartphone } from 'lucide-react';
import { useShortcuts } from '../editor/useShortcuts';
import { SelectedItemPanel } from '../pattern/SelectedItemPanel';
import { restoreWorkingCopy, startAutosave } from '../store/persist';
import { usePrefs } from '../store/prefs';
import { toast } from '../store/toast';
import { useWorkspace } from '../store/workspace';
import { AuthDialog } from './AuthDialog';
import { NewDesignDialog, Toaster } from './Overlays';
import { Header } from './Header';
import { Inspector } from './Inspector';
import { PatternStage } from './PatternStage';
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
    void restoreWorkingCopy().then((missing) => {
      if (cancelled) return;
      if (missing.length) toast(t('app.missingAssets', { count: missing.length }), 'error');
      useWorkspace.getState().requestFit();
      stop = startAutosave();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [t]);

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
      <RenderDialog />
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
