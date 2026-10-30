import { create } from 'zustand';

export interface Toast {
  id: number;
  tone: 'info' | 'error';
  text: string;
}

let seq = 0;

export const useToasts = create<{
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}>()((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    window.setTimeout(() => get().dismiss(id), t.tone === 'error' ? 6000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = (text: string, tone: Toast['tone'] = 'info') =>
  useToasts.getState().push({ text, tone });
