// Who is signed in, and what their plan allows (ADR-0011, ADR-0012).
import { create } from 'zustand';
import { ApiError, OfflineError, api, refresh, rememberCsrf, setAccessToken } from './api';

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  role: 'user' | 'admin';
  hasPassword: boolean;
}

export interface Entitlements {
  planId: string;
  limits: {
    projects: number | null;
    exportsPerMonth: number | null;
    cloudRendersPerMonth: number | null;
    renderMaxPx: number | null;
    renderQualities: string[] | null;
    watermark: boolean;
  };
  usage: { projects: number; exportsThisPeriod: number; cloudRendersThisPeriod: number };
  credits: { render: number; export: number };
}

type Status = 'unknown' | 'signedOut' | 'signedIn' | 'offline';

interface AuthResponse {
  accessToken: string;
  csrfToken?: string;
  user: User;
}

interface SessionState {
  status: Status;
  user: User | null;
  entitlements: Entitlements | null;
  /** Restore the session from the refresh cookie (on start-up). */
  init: () => Promise<void>;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  magicLink: (email: string) => Promise<void>;
  verifyMagic: (token: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  forgot: (email: string) => Promise<void>;
  reset: (token: string, password: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  signOut: () => Promise<void>;
  reloadUser: () => Promise<void>;
  reloadEntitlements: () => Promise<void>;
}

export const useSession = create<SessionState>()((set, get) => {
  const adopt = async (r: AuthResponse) => {
    rememberCsrf(r.csrfToken);
    setAccessToken(r.accessToken);
    set({ status: 'signedIn', user: r.user });
    await get().reloadEntitlements();
  };
  return {
    status: 'unknown',
    user: null,
    entitlements: null,

    init: async () => {
      try {
        if (!(await refresh())) return set({ status: 'signedOut', user: null });
        set({ status: 'signedIn', user: await api<User>('/me') });
        await get().reloadEntitlements();
      } catch (e) {
        // Unreachable, rate-limited or failing service: not "signed out". Keep working locally, try again.
        const transient = e instanceof OfflineError || (e instanceof ApiError && e.status >= 429);
        set({ status: transient ? 'offline' : 'signedOut' });
        if (transient) window.setTimeout(() => void get().init(), 30_000);
      }
    },

    signIn: async (email, password, remember) => {
      await adopt(await api<AuthResponse>('/auth/login', { method: 'POST', auth: false, body: { email, password, remember, platform: 'web' } }));
    },
    signUp: async (email, password) => {
      await adopt(await api<AuthResponse>('/auth/register', { method: 'POST', auth: false, body: { email, password, platform: 'web' } }));
    },
    magicLink: async (email) => {
      await api('/auth/magic-link', { method: 'POST', auth: false, body: { email, redirectUri: window.location.origin } });
    },
    verifyMagic: async (token) => {
      await adopt(await api<AuthResponse>('/auth/magic-link/verify', { method: 'POST', auth: false, body: { token, platform: 'web' } }));
    },
    verifyEmail: async (token) => {
      await api('/auth/email/verify', { method: 'POST', auth: false, body: { token } });
      if (get().status === 'signedIn') await get().reloadUser();
    },
    forgot: async (email) => {
      await api('/auth/password/forgot', { method: 'POST', auth: false, body: { email } });
    },
    reset: async (token, password) => {
      await api('/auth/password/reset', { method: 'POST', auth: false, body: { token, password } });
    },
    resendVerification: async () => {
      await api('/auth/email/resend', { method: 'POST' });
    },
    signOut: async () => {
      try {
        await api('/auth/logout', { method: 'POST' });
      } catch (e) {
        // Signing out locally must work offline or with an already-dead session.
        if (!(e instanceof OfflineError) && !(e instanceof ApiError)) throw e;
      }
      setAccessToken(null);
      sessionStorage.removeItem('gs:csrf');
      set({ status: 'signedOut', user: null, entitlements: null });
    },
    reloadUser: async () => {
      set({ user: await api<User>('/me') });
    },
    reloadEntitlements: async () => {
      try {
        set({ entitlements: await api<Entitlements>('/entitlements') });
      } catch (e) {
        if (!(e instanceof OfflineError)) throw e;
      }
    },
  };
});

/** True when the signed-in account may save to the cloud (verified email). */
export const canSync = (s: Pick<SessionState, 'status' | 'user'>) => s.status === 'signedIn' && !!s.user?.emailVerified;
