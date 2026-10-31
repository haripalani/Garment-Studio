// After signing in: offer to save designs made on this device while signed out (ADR-0009).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from '@gs/ui';
import { claimProjects, unclaimedProjects } from '../cloud/sync';
import { useWorkspace } from '../store/workspace';

export function ClaimDialog() {
  const { t } = useTranslation();
  const open = useWorkspace((s) => s.dialog === 'claim');
  const openDialog = useWorkspace((s) => s.openDialog);
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void unclaimedProjects().then((ps) => setIds(ps.map((p) => p.id)));
  }, [open]);

  return (
    <Modal
      open={open && ids.length > 0}
      onOpenChange={(o) => !o && openDialog(null)}
      title={t('account.upload')}
      description={t('account.uploadBody', { count: ids.length })}
      width={440}
    >
      <div className="flex justify-end gap-2">
        <Button onClick={() => openDialog(null)}>{t('account.uploadNo')}</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void claimProjects(ids).finally(() => {
              setBusy(false);
              openDialog(null);
            });
          }}
        >
          {t('account.uploadYes')}
        </Button>
      </div>
    </Modal>
  );
}
