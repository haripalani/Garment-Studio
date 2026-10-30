import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { defaultUnitForLocale, type Unit } from '@gs/core';
import { platform } from '../platform';

export type Theme = 'dark' | 'light';
export type ViewMode = 'pattern' | 'split' | '3d';

interface Prefs {
  theme: Theme;
  viewMode: ViewMode;
  unit: Unit;
  locale: string;
  tourDone: boolean;
  setTheme: (t: Theme) => void;
  setViewMode: (m: ViewMode) => void;
  setUnit: (u: Unit) => void;
  setLocale: (l: string) => void;
  setTourDone: (d: boolean) => void;
}

const browserLocale = typeof navigator === 'undefined' ? 'en' : navigator.language;

// Device-level preferences. Synced to the account (`/me/settings`) once accounts exist (Stage 6).
export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      theme: 'dark',
      viewMode: 'split',
      unit: defaultUnitForLocale(browserLocale),
      locale: 'en',
      tourDone: false,
      setTheme: (theme) => set({ theme }),
      setViewMode: (viewMode) => set({ viewMode }),
      setUnit: (unit) => set({ unit }),
      setLocale: (locale) => set({ locale }),
      setTourDone: (tourDone) => set({ tourDone }),
    }),
    {
      name: 'prefs',
      storage: createJSONStorage(() => ({
        getItem: (k) => platform.prefs.get(k),
        setItem: (k, v) => platform.prefs.set(k, v),
        removeItem: (k) => platform.prefs.remove(k),
      })),
    },
  ),
);
