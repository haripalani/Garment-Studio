import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button, Modal, cn } from '@gs/ui';
import { saveOpenDesign } from '../store/persist';
import { newDesign } from '../editor/actions';
import { useToasts } from '../store/toast';
import { useWorkspace } from '../store/workspace';

export function NewDesignDialog() {
  const { t } = useTranslation();
  const open = useWorkspace((s) => s.dialog === 'new');
  const openDialog = useWorkspace((s) => s.openDialog);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && openDialog(null)}
      title={t('newDesign.title')}
      description={t('newDesign.body')}
      width={420}
    >
      <div className="flex justify-end gap-2">
        <Button onClick={() => openDialog(null)}>{t('newDesign.cancel')}</Button>
        <Button
          variant="primary"
          onClick={() => {
            // The current design is kept (saved first), then a new one starts.
            void saveOpenDesign().finally(() => {
              newDesign();
              openDialog(null);
            });
          }}
        >
          {t('newDesign.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((x) => (
        <div
          key={x.id}
          role={x.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-center gap-3 rounded-xl border bg-panel py-2 pr-2 pl-3.5 text-[13px] text-ink shadow-panel',
            x.tone === 'error' ? 'border-danger/60' : 'border-line-strong',
          )}
        >
          {x.text}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(x.id)}
            className="flex size-6 items-center justify-center rounded text-muted hover:text-ink [&_svg]:size-3.5"
          >
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
