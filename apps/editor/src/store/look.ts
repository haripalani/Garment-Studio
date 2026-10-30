// The look (fabric, key light, studio scene) lives in the project document (ProjectDoc v2),
// so it is undoable, autosaved and shared by the 2D sheet and the 3D view.
import { completeLook, FACTORY_LOOK, type Look } from '@gs/core';
import { platform } from '../platform';
import { useDoc } from './doc';

export type { Fabric, Gobo, KeyLight, LabelShape, Look, Material, Scene } from '@gs/core';
export { FACTORY_LOOK };

type Patch<T> = { [K in keyof T]?: T[K] };

/** Subscribe to part of the current look. */
export function useLook<T>(select: (l: Look) => T): T {
  return useDoc((s) => select(s.doc.look));
}

const DEFAULTS_KEY = 'lookDefaults';

function readSaved(): Look | null {
  const raw = platform.prefs.get(DEFAULTS_KEY);
  if (!raw) return null;
  try {
    return completeLook(JSON.parse(raw) as Partial<Look>);
  } catch {
    return null;
  }
}

function editPart<K extends keyof Look>(part: K, patch: Patch<Look[K]>, label: string) {
  const keys = Object.keys(patch).sort().join(',');
  useDoc.getState().edit(
    label,
    (d) => {
      Object.assign(d.look[part], patch);
    },
    // Rapid changes to the same setting (slider drags) become one undo step.
    { merge: `look.${part}.${keys}` },
  );
}

export const look = {
  get: (): Look => useDoc.getState().doc.look,
  setFabric: (p: Patch<Look['fabric']>) => editPart('fabric', p, 'Fabric'),
  setLight: (p: Patch<Look['light']>) => editPart('light', p, 'Key light'),
  setScene: (p: Patch<Look['scene']>) => editPart('scene', p, 'Scene'),
  /** The look new designs start with: saved defaults, else factory settings. */
  initial: (): Look => readSaved() ?? FACTORY_LOOK,
  saveAsDefault: () => platform.prefs.set(DEFAULTS_KEY, JSON.stringify(useDoc.getState().doc.look)),
  resetToSaved: () => {
    const target = readSaved() ?? FACTORY_LOOK;
    useDoc.getState().edit('Reset look', (d) => {
      d.look = structuredClone(target);
    });
  },
  restoreFactory: () => {
    platform.prefs.remove(DEFAULTS_KEY);
    useDoc.getState().edit('Factory look', (d) => {
      d.look = structuredClone(FACTORY_LOOK);
    });
  },
  hasSavedDefault: () => platform.prefs.get(DEFAULTS_KEY) !== null,
};
