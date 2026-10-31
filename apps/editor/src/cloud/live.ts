// Live events from the API WebSocket (ADR-0010): project changes from other devices, and cloud render
// progress. Reconnects with backoff; authenticates with the current access token.
import { create } from 'zustand';
import { useDoc } from '../store/doc';
import { API_URL, getAccessToken, refresh, watchToken } from './api';
import { useSession } from './session';
import { deviceId, pull } from './sync';

export interface RenderEvent {
  jobId: string;
  status?: string;
  progress?: number;
  samplesDone?: number;
  outputAssetId?: string | null;
}

/** Latest known state of cloud render jobs, by id (updated from events). */
export const useRenderEvents = create<{ jobs: Record<string, RenderEvent> }>()(() => ({ jobs: {} }));

const wsUrl = () => `${API_URL.replace(/^http/, 'ws')}/ws`;

export function startLive(): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: number | undefined;

  const connect = async () => {
    window.clearTimeout(timer);
    if (stopped || useSession.getState().status !== 'signedIn') return;
    if (!getAccessToken() && !(await refresh())) return;
    const sock = new WebSocket(wsUrl());
    ws = sock;
    sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', token: getAccessToken() }));
    sock.onmessage = (m) => {
      const e = JSON.parse(String(m.data)) as { type: string; [k: string]: unknown };
      if (e.type === 'ready') attempt = 0;
      if (e.type === 'project.updated' && e.deviceId !== deviceId() && e.projectId === useDoc.getState().doc.id) {
        void pull(String(e.projectId));
      }
      if (e.type === 'render.progress' || e.type === 'render.finished') {
        const ev = e as unknown as RenderEvent;
        useRenderEvents.setState((s) => ({ jobs: { ...s.jobs, [ev.jobId]: { ...s.jobs[ev.jobId], ...ev } } }));
      }
    };
    sock.onclose = (c) => {
      if (ws !== sock) return;
      ws = null;
      if (stopped) return;
      // 4401: token expired or revoked: refresh first. Otherwise back off up to 30 s.
      const wait = Math.min(30_000, 1000 * 2 ** attempt++);
      timer = window.setTimeout(() => {
        if (c.code === 4401) {
          void refresh().then((ok) => {
            if (ok) void connect();
          });
        } else void connect();
      }, wait);
    };
  };

  const offSession = useSession.subscribe((s, prev) => {
    if (s.status === 'signedIn' && prev.status !== 'signedIn') void connect();
    if (s.status !== 'signedIn') ws?.close();
  });
  // A new access token (after a refresh) re-authenticates on the next connection.
  watchToken((t) => {
    if (!t) ws?.close();
  });
  const ping = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000);
  void connect();
  return () => {
    stopped = true;
    offSession();
    window.clearInterval(ping);
    window.clearTimeout(timer);
    ws?.close();
  };
}
