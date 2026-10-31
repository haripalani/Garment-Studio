// The project browser: designs on this device and in the account, merged into one list (ADR-0009).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, RotateCcw, Shirt, Trash2 } from 'lucide-react';
import { Badge, IconButton, Modal, Segmented } from '@gs/ui';
import { newId, type ProjectDoc } from '@gs/core';
import { api } from '../cloud/api';
import { useSession } from '../cloud/session';
import { fetchForOpen, push, settled } from '../cloud/sync';
import { useDoc } from '../store/doc';
import { library, openDoc, saveOpenDesign, type LocalProject } from '../store/persist';
import { toast } from '../store/toast';
import { useWorkspace } from '../store/workspace';
import { newDesign } from '../editor/actions';

interface CloudSummary {
  id: string;
  name: string;
  updatedAt: string;
  thumbnailUrl: string | null;
  conflictOf: string | null;
  deleted: boolean;
}

interface Item {
  id: string;
  name: string;
  updatedAt: string;
  thumb: string | null;
  local?: LocalProject;
  cloud?: CloudSummary;
}

async function cloudList(trash: boolean): Promise<CloudSummary[]> {
  const out: CloudSummary[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: CloudSummary[]; nextCursor: string | null } = await api(
      `/projects?limit=100${trash ? '&trash=true' : ''}${cursor ? `&cursor=${cursor}` : ''}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && out.length < 1000);
  return out;
}

function ago(iso: string, locale: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  }
  return rtf.format(0, 'minute');
}

export function ProjectsDialog() {
  const { t, i18n } = useTranslation();
  const open = useWorkspace((s) => s.dialog === 'projects');
  const openDialog = useWorkspace((s) => s.openDialog);
  const session = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id ?? null);
  const currentId = useDoc((s) => s.doc.id);
  const [view, setView] = useState<'all' | 'trash'>('all');
  const [items, setItems] = useState<Item[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Only the newest load may update the list (a slow earlier load must not overwrite a newer view). */
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    await saveOpenDesign().catch(() => undefined);
    const trash = view === 'trash';
    const locals = (await library.all()).filter((p) => (p.ownerId === null || p.ownerId === userId) && !!p.deleted === trash);
    let clouds: CloudSummary[] = [];
    if (session === 'signedIn') clouds = await cloudList(trash).catch(() => []);
    const map = new Map<string, Item>();
    for (const c of clouds) map.set(c.id, { id: c.id, name: c.name, updatedAt: c.updatedAt, thumb: c.thumbnailUrl, cloud: c });
    for (const l of locals) {
      const prev = map.get(l.id);
      const newer = !prev || Date.parse(l.updatedAt) >= Date.parse(prev.updatedAt);
      map.set(l.id, {
        id: l.id,
        name: newer ? l.doc.name : prev!.name,
        updatedAt: newer ? l.updatedAt : prev!.updatedAt,
        thumb: prev?.thumb ?? l.thumb ?? null,
        local: l,
        ...(prev?.cloud ? { cloud: prev.cloud } : {}),
      });
    }
    if (seq !== loadSeq.current) return;
    setItems([...map.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
  }, [view, session, userId]);
  // Actions reload whatever view is showing by then, not the one they started in.
  const reload = useRef(load);
  reload.current = load;

  useEffect(() => {
    if (open) {
      setItems(null);
      void load();
    }
  }, [open, load]);

  const openItem = async (it: Item) => {
    await saveOpenDesign();
    let doc: ProjectDoc;
    if (it.local && !it.local.deleted) doc = it.local.doc;
    else doc = await fetchForOpen(it.id);
    const missing = await openDoc(doc);
    if (missing.length) toast(t('app.missingAssets', { count: missing.length }), 'error');
    useWorkspace.getState().requestFit();
    openDialog(null);
  };

  const rename = async (it: Item, name: string) => {
    setRenaming(null);
    const clean = name.trim().slice(0, 120);
    if (!clean || clean === it.name) return;
    if (it.id === currentId) useDoc.getState().edit('Rename design', (d) => void (d.name = clean));
    else if (it.local) await library.update(it.id, (r) => ({ ...r, doc: { ...r.doc, name: clean }, dirty: true }));
    if (it.cloud) await api(`/projects/${it.id}`, { method: 'PATCH', body: { name: clean } }).catch(() => undefined);
    await reload.current();
  };

  const duplicate = async (it: Item) => {
    const source = it.local?.doc ?? (await fetchForOpen(it.id));
    const id = newId();
    const doc = { ...structuredClone(source), id, name: `${source.name} (copy)`.slice(0, 120), updatedAt: new Date().toISOString() };
    await library.put({ id, doc, cloud: null, dirty: true, ownerId: userId, updatedAt: doc.updatedAt });
    void push(id);
    await reload.current();
  };

  const remove = async (it: Item) => {
    // A first upload may still be running (e.g. just duplicated): let it finish, then delete everywhere.
    await settled(it.id);
    const inCloud = it.cloud || (await library.get(it.id))?.cloud;
    if (inCloud) await api(`/projects/${it.id}`, { method: 'DELETE' }).catch(() => undefined);
    if (it.local) await library.update(it.id, (r) => ({ ...r, deleted: true }));
    if (it.id === currentId) newDesign();
    toast(t('projects.deleted', { name: it.name }));
    await reload.current();
  };

  const restore = async (it: Item) => {
    if (it.cloud) await api(`/projects/${it.id}/restore`, { method: 'POST' });
    if (it.local) await library.update(it.id, (r) => ({ ...r, deleted: false }));
    await reload.current();
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && openDialog(null)} title={t('projects.title')} width={820}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Segmented<'all' | 'trash'>
            label={t('projects.title')}
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'all', label: t('projects.all') },
              { value: 'trash', label: t('projects.trash') },
            ]}
          />
          {session !== 'signedIn' && <span className="text-[12px] text-muted">{t('projects.signInHint')}</span>}
        </div>
        {!items ? (
          <p className="m-0 py-10 text-center text-[13px] text-muted">{t('projects.loading')}</p>
        ) : !items.length ? (
          <p className="m-0 py-10 text-center text-[13px] text-muted">{t('projects.empty')}</p>
        ) : (
          <ul aria-label={t('projects.title')} className="m-0 grid max-h-[520px] list-none grid-cols-3 gap-3 overflow-auto p-0">
            {items.map((it) => (
              <li key={it.id} aria-label={it.name} className="flex flex-col overflow-hidden rounded-xl border border-line bg-mat-in">
                <button
                  type="button"
                  disabled={view === 'trash'}
                  onClick={() => void openItem(it)}
                  aria-label={`${t('projects.open')} ${it.name}`}
                  className="flex aspect-[4/3] items-center justify-center bg-stage text-muted [&_svg]:size-10"
                >
                  {it.thumb ? <img src={it.thumb} alt="" className="h-full w-full object-contain" /> : <Shirt />}
                </button>
                <div className="flex flex-col gap-1 p-2.5">
                  {renaming === it.id ? (
                    <input
                      autoFocus
                      aria-label={t('projects.nameLabel')}
                      defaultValue={it.name}
                      onBlur={(e) => void rename(it, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void rename(it, e.currentTarget.value);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="h-7 rounded border border-line-strong bg-field px-2 text-[13px] text-ink"
                    />
                  ) : (
                    <span className="truncate text-[13px] font-semibold text-ink">{it.name || 'Untitled design'}</span>
                  )}
                  <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                    {it.id === currentId && <Badge tone="accent">{t('projects.current')}</Badge>}
                    {(it.cloud?.conflictOf || it.local?.conflictOf) && <Badge tone="warn">{t('projects.conflicted')}</Badge>}
                    <Badge>{it.cloud ? t('projects.inCloud') : t('projects.onDevice')}</Badge>
                    {t('projects.edited', { when: ago(it.updatedAt, i18n.language) })}
                  </span>
                  <span className="flex justify-end gap-0.5">
                    {view === 'trash' ? (
                      <IconButton label={`${t('projects.restore')} ${it.name}`} icon={<RotateCcw />} onClick={() => void restore(it)} />
                    ) : (
                      <>
                        <IconButton label={`${t('projects.rename')} ${it.name}`} icon={<Pencil />} onClick={() => setRenaming(it.id)} />
                        <IconButton label={`${t('projects.duplicate')} ${it.name}`} icon={<Copy />} onClick={() => void duplicate(it)} />
                        <IconButton label={`${t('projects.delete')} ${it.name}`} icon={<Trash2 />} onClick={() => void remove(it)} />
                      </>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
