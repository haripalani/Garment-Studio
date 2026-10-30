// Platform adapter (TECHNICAL_ARCHITECTURE §3). Stage 3 ships the web adapter;
// the Tauri adapter (native files, keychain, updater) lands in Stage 10 behind the same interface.

export type PlatformKind = 'web' | 'pwa' | 'desktop';

export interface PrefsStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface Platform {
  kind: PlatformKind;
  prefs: PrefsStore;
}

const PREFIX = 'gs:';

// localStorage can throw (private mode, blocked storage); preferences then live for the session only.
function webPrefs(): PrefsStore {
  const memory = new Map<string, string>();
  return {
    get(key) {
      try {
        return window.localStorage.getItem(PREFIX + key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(PREFIX + key, value);
      } catch {
        memory.set(key, value);
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(PREFIX + key);
      } catch {
        memory.delete(key);
      }
    },
  };
}

function detectKind(): PlatformKind {
  if (typeof window === 'undefined') return 'web';
  if ('__TAURI_INTERNALS__' in window) return 'desktop';
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa';
  return 'web';
}

export function createPlatform(): Platform {
  return { kind: detectKind(), prefs: webPrefs() };
}
